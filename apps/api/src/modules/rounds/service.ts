import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { QR_WINDOW_SECONDS, ROUND_KINDS, type RoundType } from "@cyrus/shared";
import type { Db } from "../../lib/db.ts";
import type { Mailer } from "../../lib/mail.ts";
import type { Env } from "../../config/env.ts";
import type { AuthContext } from "../../http/auth-context.ts";
import { ApiError } from "../../http/errors.ts";
import { audit } from "../../lib/audit.ts";
import { emit } from "../../lib/outbox.ts";
import { notifyInApp, sendAfterCommit } from "../../lib/notify.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;
type Result = "SELECTED" | "REJECTED" | "ON_HOLD" | "PENDING";

export interface RoundsDeps {
  db: Db;
  mailer: Mailer;
  env: Env;
  /** Tests fix the clock for the rotating QR. */
  now?: () => number;
}

/** PPT has no result: finishing it only records who came. */
const hasResults = (type: RoundType) => type !== "PPT";

/** Distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** "selected", "Pass", "1", "qualified"… → a result. Unknown words → null. */
export function parseResultWord(raw: string): Exclude<Result, "PENDING"> | null {
  const v = raw.trim().toLowerCase();
  if (["selected", "select", "pass", "passed", "qualified", "cleared", "yes", "y", "1", "shortlisted"].includes(v)) return "SELECTED";
  if (["rejected", "reject", "fail", "failed", "not qualified", "not selected", "no", "n", "0"].includes(v)) return "REJECTED";
  if (["hold", "on hold", "on_hold", "waitlist", "waitlisted"].includes(v)) return "ON_HOLD";
  return null;
}

/** Splits simple CSV (quoted fields allowed) into rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") cells.push(cur.trim()), (cur = "");
      else cur += c;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

export function createRoundsService({ db, mailer, env, now = Date.now }: RoundsDeps) {
  const link = (path: string) => `${env.WEB_APP_URL}${path}`;

  // ───────────── access ─────────────

  /** TPO: every round. HR: their company's. Attendance helpers (drive.attendance): any round, for attendance only. */
  async function ownRound(auth: AuthContext, id: string, opts: { attendanceHelper?: boolean } = {}) {
    const round = await db.round.findUnique({
      where: { id },
      include: { drive: { include: { company: { select: { id: true, name: true } }, rounds: { orderBy: { sequence: "asc" }, select: { id: true, sequence: true, status: true, title: true, type: true } } } } },
    });
    if (!round) throw new ApiError(404, "NOT_FOUND", "Round not found.");
    if (auth.has("TPO")) return round;
    if (opts.attendanceHelper && auth.can("drive.attendance")) return round;
    const member = auth.has("COMPANY_HR") && (await db.companyMember.findFirst({ where: { userId: auth.userId, companyId: round.drive.companyId, role: "HR", active: true } }));
    if (!member) throw new ApiError(404, "NOT_FOUND", "Round not found.");
    return round;
  }
  type LoadedRound = Awaited<ReturnType<typeof ownRound>>;

  /** Students still in the drive (joined and not out yet): the people a running round is about. */
  const activeWhere = (driveId: string): Prisma.ParticipationWhereInput => ({ driveId, status: "OPTED_IN" });

  // ───────────── view ─────────────

  async function view(auth: AuthContext, id: string) {
    const round = await ownRound(auth, id, { attendanceHelper: true });
    const finished = round.status === "RESULTS_PUBLISHED";
    // A finished round shows the people it had (everyone with a result or attendance row); a running one, who is still in.
    const people = await db.participation.findMany({
      where: finished
        ? { OR: [{ results: { some: { roundId: id } } }, { attendance: { some: { roundId: id } } }, { eliminatedAtRoundId: id }] }
        : round.status === "SCHEDULED"
          ? activeWhere(round.driveId)
          : { OR: [activeWhere(round.driveId), { results: { some: { roundId: id } } }] },
      orderBy: { student: { rollNo: "asc" } },
      select: {
        id: true,
        status: true,
        eliminatedAtRoundId: true,
        student: { select: { id: true, name: true, rollNo: true, branch: true, batch: true, cgpa: true } },
        attendance: { where: { roundId: id }, select: { method: true, createdAt: true, reason: true } },
        results: { where: { roundId: id }, select: { result: true, source: true } },
      },
    });
    const session = await db.attendanceSession.findFirst({ where: { roundId: id, status: "OPEN" }, select: { id: true, openedAt: true, venueLat: true, venueLng: true, radiusM: true } });
    const tookAttendance = (await db.attendanceSession.count({ where: { roundId: id } })) > 0;
    const idx = round.drive.rounds.findIndex((r) => r.id === id);
    const earlierOpen = round.drive.rounds.slice(0, idx).some((r) => r.status !== "RESULTS_PUBLISHED" && r.status !== "CANCELLED");
    const tpo = auth.has("TPO");
    const manager = tpo || auth.has("COMPANY_HR");
    const running = round.status === "IN_PROGRESS" || round.status === "RESULTS_PENDING";
    const rows = people.map((p) => ({
      ...p.student,
      participationId: p.id,
      status: p.status,
      present: p.attendance.length > 0,
      attendance: p.attendance[0] ?? null,
      result: (p.results[0]?.result ?? "PENDING") as Result,
      source: p.results[0]?.source ?? null,
    }));
    const pending = rows.filter((r) => r.result === "PENDING" && !(tookAttendance && !r.present)).length;
    const onHold = rows.filter((r) => r.result === "ON_HOLD").length;
    return {
      id: round.id,
      sequence: round.sequence,
      type: round.type,
      title: round.title,
      mode: round.mode,
      startsAt: round.startsAt,
      venue: round.venue,
      venueLat: round.venueLat,
      venueLng: round.venueLng,
      venueRadiusM: round.venueRadiusM,
      status: round.status,
      hasResults: hasResults(round.type as RoundType),
      isLast: round.drive.rounds.filter((r) => r.status !== "CANCELLED").at(-1)?.id === id,
      drive: { id: round.driveId, roleTitle: round.drive.roleTitle, company: round.drive.company, status: round.drive.status },
      session,
      tookAttendance,
      students: rows,
      counts: { total: rows.length, present: rows.filter((r) => r.present).length, pending, onHold, selected: rows.filter((r) => r.result === "SELECTED").length },
      can: {
        start: manager && round.status === "SCHEDULED" && !earlierOpen && ["PUBLISHED", "ONGOING"].includes(round.drive.status),
        startBlockedBy: round.status === "SCHEDULED" && earlierOpen ? "Publish the results of the earlier rounds first." : null,
        attendance: running,
        manual: running && (tpo || auth.can("drive.attendance")),
        results: manager && running && hasResults(round.type as RoundType),
        // Publishing waits until check-in is closed (otherwise everyone not yet in would count as absent).
        publish: manager && running && !session,
      },
    };
  }

  // ───────────── lifecycle ─────────────

  async function start(auth: AuthContext, id: string) {
    const r = await view(auth, id);
    if (!r.can.start) throw new ApiError(409, "CANT_START", r.can.startBlockedBy ?? "This round can't be started now.");
    const round = await ownRound(auth, id);
    const firstStart = round.drive.status === "PUBLISHED";
    const emails = await db.$transaction(async (tx) => {
      if (firstStart) {
        // The first round closes joining: unanswered invites expire.
        const nowDate = new Date(now());
        await tx.drive.update({
          where: { id: round.driveId },
          data: { status: "ONGOING", optInDeadline: round.drive.optInDeadline && round.drive.optInDeadline < nowDate ? round.drive.optInDeadline : nowDate },
        });
        await tx.participation.updateMany({ where: { driveId: round.driveId, status: "INVITED" }, data: { status: "EXPIRED" } });
      }
      const active = await tx.participation.count({ where: activeWhere(round.driveId) });
      if (!active) throw new ApiError(409, "NO_ONE_IN_DRIVE", "No student has joined this drive, so there's no one to run the round with.");
      await tx.round.update({ where: { id }, data: { status: "IN_PROGRESS" } });
      await audit(tx, { actorId: auth.userId, action: "round.started", entityType: "Round", entityId: id });
      await emit(tx, "round.updated", { driveId: round.driveId, roundId: id, status: "IN_PROGRESS" });
      return tellActive(tx, round, `${round.title} has started`, round.mode === "ONLINE" ? "Open the drive for the link and instructions." : `Go to ${round.venue ?? "the venue"}. If a check-in QR code is shown there, scan it with your phone camera.`);
    });
    await sendAfterCommit(mailer, emails);
    return view(auth, id);
  }

  async function tellActive(tx: Tx, round: LoadedRound, title: string, body: string) {
    const people = await tx.participation.findMany({ where: activeWhere(round.driveId), select: { student: { select: { userId: true } } } });
    const out = [];
    for (const p of people) out.push(await notifyInApp(tx, { userId: p.student.userId, channel: "DRIVES", title: `${round.drive.company.name}: ${title}`, body, link: link(`/student/drives/${round.driveId}`) }));
    return out;
  }

  // ───────────── results ─────────────

  async function resultsRound(auth: AuthContext, id: string) {
    const round = await ownRound(auth, id);
    if (!hasResults(round.type as RoundType)) throw new ApiError(409, "NO_RESULTS", "A pre-placement talk has no results.");
    if (round.status !== "IN_PROGRESS" && round.status !== "RESULTS_PENDING") {
      throw new ApiError(409, "BAD_STATE", round.status === "SCHEDULED" ? "Start the round before entering results." : "Results of this round are already published.");
    }
    return round;
  }

  async function setResults(auth: AuthContext, id: string, results: { participationId: string; result: Result }[], source: "MANUAL" | "IMPORT" = "MANUAL") {
    const round = await resultsRound(auth, id);
    const active = await db.participation.findMany({ where: { ...activeWhere(round.driveId), id: { in: results.map((r) => r.participationId) } }, select: { id: true } });
    const ok = new Set(active.map((a) => a.id));
    const outside = results.filter((r) => !ok.has(r.participationId));
    if (outside.length) throw new ApiError(400, "NOT_IN_ROUND", `${outside.length} of these students aren't in this round.`);
    await db.$transaction(async (tx) => {
      for (const r of results) {
        await tx.roundResult.upsert({
          where: { roundId_participationId: { roundId: id, participationId: r.participationId } },
          create: { roundId: id, participationId: r.participationId, result: r.result, source, setById: auth.userId },
          update: { result: r.result, source, setById: auth.userId },
        });
      }
      await tx.round.update({ where: { id }, data: { status: "RESULTS_PENDING" } });
      await audit(tx, { actorId: auth.userId, action: "round.results_saved", entityType: "Round", entityId: id, after: { count: results.length, source } });
    });
    return view(auth, id);
  }

  /** CSV from an outside test platform: a roll-number column and a result column, matched by roll number. */
  async function importResults(auth: AuthContext, id: string, csv: string) {
    const round = await resultsRound(auth, id);
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new ApiError(400, "EMPTY_FILE", "The file has no rows under the header.");
    const head = rows[0]!.map((h) => h.toLowerCase());
    const rollCol = head.findIndex((h) => /roll|enrol|registration|^id$/.test(h));
    const resCol = head.findIndex((h) => /result|status|outcome|qualified|selected/.test(h));
    if (rollCol < 0 || resCol < 0) {
      throw new ApiError(400, "COLUMNS_NOT_FOUND", 'The first row needs a roll number column and a result column, e.g. "Roll number,Result".', { header: rows[0] });
    }
    const active = await db.participation.findMany({ where: activeWhere(round.driveId), select: { id: true, student: { select: { rollNo: true } } } });
    const byRoll = new Map(active.map((a) => [a.student.rollNo.toUpperCase(), a.id]));
    const unknownRolls: string[] = [];
    const badValues: { row: number; value: string }[] = [];
    const results: { participationId: string; result: Result }[] = [];
    rows.slice(1).forEach((cells, i) => {
      const roll = (cells[rollCol] ?? "").toUpperCase();
      const pid = byRoll.get(roll);
      const value = parseResultWord(cells[resCol] ?? "");
      if (!pid) unknownRolls.push(roll || `(row ${i + 2} empty)`);
      else if (!value) badValues.push({ row: i + 2, value: cells[resCol] ?? "" });
      else results.push({ participationId: pid, result: value });
    });
    if (!results.length) throw new ApiError(400, "NOTHING_MATCHED", "No row matched a student in this round.", { unknownRolls: unknownRolls.slice(0, 50), badValues: badValues.slice(0, 50) });
    const out = await setResults(auth, id, results, "IMPORT");
    return { round: out, imported: results.length, unknownRolls: unknownRolls.slice(0, 50), badValues: badValues.slice(0, 50) };
  }

  /**
   * Publishes the round: rejected students are out, absent students are marked absent, selected students
   * go on (or are selected for the job after the last round). Everyone is told. Can't be undone.
   */
  async function publish(auth: AuthContext, id: string) {
    const v = await view(auth, id);
    if (v.session) throw new ApiError(409, "CHECK_IN_OPEN", "Close check-in before publishing.");
    const live = await db.queueEntry.count({ where: { panel: { roundId: id }, status: { in: ["CALLED", "IN_INTERVIEW"] } } });
    if (live) throw new ApiError(409, "INTERVIEWS_RUNNING", `${live} interview(s) are still going on. Let the panels finish first.`);
    if (!v.can.publish) throw new ApiError(409, "BAD_STATE", "This round isn't running, so there is nothing to publish.");
    if (v.hasResults && v.counts.pending) throw new ApiError(409, "RESULTS_MISSING", `${v.counts.pending} student(s) have no result yet.`);
    if (v.counts.onHold) throw new ApiError(409, "ON_HOLD_LEFT", `Decide on the ${v.counts.onHold} student(s) on hold before publishing.`);
    const round = await ownRound(auth, id);
    const next = round.drive.rounds.find((r) => r.sequence > round.sequence && r.status !== "CANCELLED");
    const policy = await db.placementPolicy.findUnique({ where: { id: "default" } });
    const warnAfter = policy?.noShowWarnAfter ?? 1;

    const emails = await db.$transaction(async (tx) => {
      const out = [];
      const company = round.drive.company.name;
      const drivePath = link(`/student/drives/${round.driveId}`);
      for (const s of v.students.filter((x) => x.status === "OPTED_IN")) {
        const user = await tx.studentProfile.findUniqueOrThrow({ where: { id: s.id }, select: { userId: true } });
        const absent = v.tookAttendance && !s.present;
        if (absent) {
          await tx.participation.update({ where: { id: s.participationId }, data: { status: "NO_SHOW", eliminatedAtRoundId: id } });
          const p = await tx.studentProfile.update({ where: { id: s.id }, data: { noShowCount: { increment: 1 } }, select: { noShowCount: true } });
          const warn = p.noShowCount >= warnAfter ? " Missing rounds after joining a drive counts against you; the placement office may block you from future drives." : "";
          out.push(await notifyInApp(tx, { userId: user.userId, channel: "DRIVES", title: `${company}: marked absent in ${round.title}`, body: `You were not checked in for ${round.title}, so you are out of this drive.${warn}`, link: drivePath }));
        } else if (v.hasResults && s.result === "REJECTED") {
          await tx.participation.update({ where: { id: s.participationId }, data: { status: "ELIMINATED", eliminatedAtRoundId: id } });
          out.push(await notifyInApp(tx, { userId: user.userId, channel: "DRIVES", title: `${company}: ${round.title} result`, body: `You were not selected in ${round.title}. Thank you for taking part.`, link: drivePath }));
        } else if (!next) {
          await tx.participation.update({ where: { id: s.participationId }, data: { status: "SELECTED" } });
          out.push(await notifyInApp(tx, { userId: user.userId, channel: "OFFERS", title: `${company}: you're selected!`, body: `You cleared every round of ${round.drive.roleTitle}. The company will share the offer letter here.`, link: drivePath }));
        } else if (v.hasResults) {
          out.push(await notifyInApp(tx, { userId: user.userId, channel: "DRIVES", title: `${company}: you cleared ${round.title}`, body: `You are through to ${next.title}.`, link: drivePath }));
        }
      }
      await tx.round.update({ where: { id }, data: { status: "RESULTS_PUBLISHED", resultsPublishedAt: new Date(now()) } });
      await tx.attendanceSession.updateMany({ where: { roundId: id, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date(now()) } });
      if (!next) await tx.drive.update({ where: { id: round.driveId }, data: { status: "RESULTS_DECLARED" } });
      await audit(tx, { actorId: auth.userId, action: "round.results_published", entityType: "Round", entityId: id });
      await emit(tx, "round.results_published", { driveId: round.driveId, roundId: id });
      if (!next) await emit(tx, "drive.final_results_published", { driveId: round.driveId });
      return out;
    });
    await sendAfterCommit(mailer, emails);
    return view(auth, id);
  }

  // ───────────── attendance ─────────────

  const windowNo = () => Math.floor(now() / 1000 / QR_WINDOW_SECONDS);
  const sign = (secret: string, sid: string, w: number) => createHmac("sha256", secret).update(`${sid}.${w}`).digest("base64url").slice(0, 16);

  async function openSession(auth: AuthContext, id: string, body: { lat?: number | null; lng?: number | null; radiusM?: number | null }) {
    const round = await ownRound(auth, id, { attendanceHelper: true });
    if (round.status !== "IN_PROGRESS" && round.status !== "RESULTS_PENDING") throw new ApiError(409, "BAD_STATE", "Start the round before opening check-in.");
    if (round.mode === "ONLINE") throw new ApiError(409, "ONLINE_ROUND", "This round is online. Mark attendance by hand or from the test platform's results.");
    const open = await db.attendanceSession.findFirst({ where: { roundId: id, status: "OPEN" } });
    if (open) return sessionView(open.id);
    const lat = body.lat ?? round.venueLat;
    const lng = body.lng ?? round.venueLng;
    const s = await db.$transaction(async (tx) => {
      const created = await tx.attendanceSession.create({
        data: { roundId: id, openedById: auth.userId, qrSecret: randomBytes(24).toString("base64url"), venueLat: lat, venueLng: lng, radiusM: lat != null ? (body.radiusM ?? round.venueRadiusM ?? 150) : null },
      });
      await audit(tx, { actorId: auth.userId, action: "attendance.opened", entityType: "Round", entityId: id, after: { withLocation: lat != null } });
      return created;
    });
    return sessionView(s.id);
  }

  async function sessionView(sid: string) {
    const s = await db.attendanceSession.findUniqueOrThrow({ where: { id: sid }, select: { id: true, roundId: true, status: true, openedAt: true, venueLat: true, venueLng: true, radiusM: true } });
    return s;
  }

  async function ownSession(auth: AuthContext, sid: string) {
    const s = await db.attendanceSession.findUnique({ where: { id: sid } });
    if (!s) throw new ApiError(404, "NOT_FOUND", "Check-in not found.");
    await ownRound(auth, s.roundId, { attendanceHelper: true });
    return s;
  }

  /** The QR value for the venue screen. It changes every QR_WINDOW_SECONDS; a photo of it soon stops working. */
  async function qr(auth: AuthContext, sid: string) {
    const s = await ownSession(auth, sid);
    if (s.status !== "OPEN") throw new ApiError(409, "CLOSED", "Check-in is closed.");
    const w = windowNo();
    const token = `${s.id}.${w}.${sign(s.qrSecret, s.id, w)}`;
    const present = await db.attendance.count({ where: { roundId: s.roundId } });
    const msLeft = (w + 1) * QR_WINDOW_SECONDS * 1000 - now();
    return { token, url: link(`/check-in?t=${encodeURIComponent(token)}`), expiresInMs: msLeft, present };
  }

  async function closeSession(auth: AuthContext, sid: string) {
    const s = await ownSession(auth, sid);
    await db.$transaction(async (tx) => {
      await tx.attendanceSession.update({ where: { id: sid }, data: { status: "CLOSED", closedAt: new Date(now()) } });
      await audit(tx, { actorId: auth.userId, action: "attendance.closed", entityType: "Round", entityId: s.roundId });
    });
    return view(auth, s.roundId);
  }

  async function checkIn(userId: string, body: { token: string; lat?: number | null; lng?: number | null }) {
    const [sid, wRaw, sig] = body.token.split(".");
    const w = Number(wRaw);
    const s = sid && /^[0-9a-f-]{36}$/.test(sid) ? await db.attendanceSession.findUnique({ where: { id: sid }, include: { round: { select: { id: true, title: true, driveId: true, drive: { select: { roleTitle: true, company: { select: { name: true } } } } } } } }) : null;
    const expected = s && Number.isInteger(w) ? Buffer.from(sign(s.qrSecret, s.id, w)) : null;
    const given = Buffer.from(sig ?? "");
    if (!s || !expected || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ApiError(400, "BAD_CODE", "This QR code isn't valid. Scan the code on the screen at the venue.");
    // The current code and the one just before it are accepted (scanning takes a few seconds).
    const current = windowNo();
    if (w !== current && w !== current - 1) throw new ApiError(410, "CODE_EXPIRED", "This QR code has expired. Scan the code on the screen again.");
    if (s.status !== "OPEN") throw new ApiError(409, "CLOSED", "Check-in for this round is closed. Talk to the coordinator at the venue.");

    const me = await db.studentProfile.findUnique({ where: { userId }, select: { id: true } });
    const p = me && (await db.participation.findUnique({ where: { driveId_studentId: { driveId: s.round.driveId, studentId: me.id } } }));
    if (!p || p.status !== "OPTED_IN") throw new ApiError(403, "NOT_IN_ROUND", "You aren't in this round, so you can't check in.");

    let dist: number | null = null;
    if (s.venueLat != null && s.venueLng != null) {
      if (body.lat == null || body.lng == null) throw new ApiError(400, "LOCATION_NEEDED", "Allow location access so we can confirm you are at the venue.");
      dist = distanceM({ lat: s.venueLat, lng: s.venueLng }, { lat: body.lat, lng: body.lng });
      if (dist > (s.radiusM ?? 150)) throw new ApiError(403, "TOO_FAR", `You seem to be ${dist} m from the venue. Check in from inside the venue.`, { distanceM: dist });
    }
    const already = await db.attendance.findUnique({ where: { roundId_participationId: { roundId: s.roundId, participationId: p.id } } });
    if (!already) {
      await db.$transaction(async (tx) => {
        await tx.attendance.create({ data: { roundId: s.roundId, participationId: p.id, sessionId: s.id, method: "QR", lat: body.lat ?? null, lng: body.lng ?? null, distanceM: dist } });
        await emit(tx, "attendance.marked", { roundId: s.roundId, participationId: p.id });
      });
    }
    return { checkedIn: true, alreadyCheckedIn: !!already, round: s.round.title, company: s.round.drive.company.name, roleTitle: s.round.drive.roleTitle, driveId: s.round.driveId };
  }

  async function markManual(auth: AuthContext, id: string, body: { participationId: string; present: boolean; reason: string }) {
    const round = await ownRound(auth, id, { attendanceHelper: true });
    if (!(auth.has("TPO") || auth.can("drive.attendance"))) throw new ApiError(403, "FORBIDDEN", "Only the placement office marks attendance by hand.");
    if (round.status !== "IN_PROGRESS" && round.status !== "RESULTS_PENDING") throw new ApiError(409, "BAD_STATE", "Attendance can be changed only while the round is running.");
    const p = await db.participation.findFirst({ where: { id: body.participationId, ...activeWhere(round.driveId) } });
    if (!p) throw new ApiError(404, "NOT_IN_ROUND", "This student isn't in the round.");
    await db.$transaction(async (tx) => {
      if (body.present) {
        await tx.attendance.upsert({
          where: { roundId_participationId: { roundId: id, participationId: p.id } },
          create: { roundId: id, participationId: p.id, method: "MANUAL", markedById: auth.userId, reason: body.reason },
          update: {},
        });
      } else {
        await tx.attendance.deleteMany({ where: { roundId: id, participationId: p.id } });
      }
      await audit(tx, { actorId: auth.userId, action: body.present ? "attendance.marked_manual" : "attendance.unmarked", entityType: "Participation", entityId: p.id, reason: body.reason, after: { roundId: id } });
    });
    return view(auth, id);
  }

  // ───────────── for the student's drive page ─────────────

  /** Per round: did I attend, my published result, and whether check-in is open now. */
  async function mine(participationId: string, driveId: string) {
    const [att, res, open] = await Promise.all([
      db.attendance.findMany({ where: { participationId }, select: { roundId: true } }),
      db.roundResult.findMany({ where: { participationId, round: { status: "RESULTS_PUBLISHED" } }, select: { roundId: true, result: true } }),
      db.attendanceSession.findMany({ where: { status: "OPEN", round: { driveId } }, select: { roundId: true } }),
    ]);
    return { attended: new Set(att.map((a) => a.roundId)), results: new Map(res.map((r) => [r.roundId, r.result])), checkInOpen: new Set(open.map((o) => o.roundId)) };
  }

  return { view, start, setResults, importResults, publish, openSession, qr, closeSession, checkIn, markManual, mine, kindLabel: (t: RoundType) => ROUND_KINDS[t].label };
}

export type RoundsService = ReturnType<typeof createRoundsService>;
