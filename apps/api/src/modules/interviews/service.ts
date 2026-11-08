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

export interface InterviewsDeps {
  db: Db;
  mailer: Mailer;
  env: Env;
  now?: () => number;
}

/** Used for the wait estimate until a panel has finished a few interviews of its own. */
export const DEFAULT_INTERVIEW_MINUTES = 15;
/** A student skipped this many times (not there when called) is marked absent from the line. */
export const MAX_SKIPS = 2;

const LIVE = ["CALLED", "IN_INTERVIEW"] as const;

/** Average length of finished interviews on a panel, in minutes (rounded), or the default. */
export function averageMinutes(sessions: { startedAt: Date; endedAt: Date | null }[]): number {
  const done = sessions.filter((s) => s.endedAt).map((s) => (s.endedAt!.getTime() - s.startedAt.getTime()) / 60_000);
  if (done.length < 2) return DEFAULT_INTERVIEW_MINUTES;
  return Math.max(1, Math.round(done.reduce((a, b) => a + b, 0) / done.length));
}

export function createInterviewsService({ db, mailer, env, now = Date.now }: InterviewsDeps) {
  const link = (path: string) => `${env.WEB_APP_URL}${path}`;

  // ───────────── access ─────────────

  async function companyRole(auth: AuthContext, companyId: string) {
    if (auth.has("TPO")) return "TPO" as const;
    const m = await db.companyMember.findFirst({ where: { userId: auth.userId, companyId, active: true }, select: { role: true } });
    return m?.role ?? null; // "HR" | "INTERVIEWER" | null
  }

  /** A round the caller manages (TPO, or HR of the company). */
  async function manageRound(auth: AuthContext, roundId: string) {
    const round = await db.round.findUnique({ where: { id: roundId }, include: { drive: { select: { id: true, companyId: true, roleTitle: true, company: { select: { name: true } } } } } });
    if (!round) throw new ApiError(404, "NOT_FOUND", "Round not found.");
    const r = await companyRole(auth, round.drive.companyId);
    if (r !== "TPO" && r !== "HR") throw new ApiError(404, "NOT_FOUND", "Round not found.");
    return round;
  }

  /** A panel the caller may run: the TPO, the company's HR, or an interviewer sitting on it. */
  async function runPanel(auth: AuthContext, panelId: string) {
    const panel = await db.panel.findUnique({
      where: { id: panelId },
      include: { members: { select: { userId: true } }, round: { include: { drive: { select: { id: true, companyId: true, roleTitle: true, company: { select: { name: true } } } } } } },
    });
    if (!panel) throw new ApiError(404, "NOT_FOUND", "Panel not found.");
    const r = await companyRole(auth, panel.round.drive.companyId);
    const member = panel.members.some((m) => m.userId === auth.userId);
    if (!(r === "TPO" || r === "HR" || (r === "INTERVIEWER" && member))) throw new ApiError(404, "NOT_FOUND", "Panel not found.");
    return panel;
  }

  const running = (status: string) => status === "IN_PROGRESS" || status === "RESULTS_PENDING";

  async function entryOf(auth: AuthContext, entryId: string) {
    const entry = await db.queueEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new ApiError(404, "NOT_FOUND", "Not in the line.");
    const panel = await runPanel(auth, entry.panelId);
    if (!running(panel.round.status)) throw new ApiError(409, "ROUND_NOT_RUNNING", "This round isn't running.");
    return { entry, panel };
  }

  /** Locks the panel's line for the rest of the transaction, so two clicks can't call two students. */
  const lockPanel = (tx: Tx, panelId: string) => tx.$queryRaw`SELECT id FROM "Panel" WHERE id = ${panelId}::uuid FOR UPDATE`;

  async function tellStudent(tx: Tx, participationId: string, title: string, body: string, driveId: string) {
    const p = await tx.participation.findUniqueOrThrow({ where: { id: participationId }, select: { student: { select: { userId: true } } } });
    return notifyInApp(tx, { userId: p.student.userId, channel: "QUEUE", title, body, link: link(`/student/drives/${driveId}`) });
  }

  // ───────────── people who can sit on panels ─────────────

  /** HR and interviewers of the round's company, for the panel member picker. */
  async function people(auth: AuthContext, roundId: string) {
    const round = await manageRound(auth, roundId);
    const members = await db.companyMember.findMany({
      where: { companyId: round.drive.companyId, active: true },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    return { people: members.map((m) => ({ ...m.user, role: m.role })) };
  }

  // ───────────── panels ─────────────

  async function panels(roundId: string) {
    const list = await db.panel.findMany({
      where: { roundId },
      orderBy: { createdAt: "asc" },
      include: {
        members: { select: { user: { select: { id: true, name: true, email: true } } } },
        queue: { select: { status: true } },
        sessions: { select: { startedAt: true, endedAt: true } },
      },
    });
    return list.map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location,
      members: p.members.map((m) => m.user),
      counts: {
        waiting: p.queue.filter((q) => q.status === "WAITING").length,
        live: p.queue.filter((q) => (LIVE as readonly string[]).includes(q.status)).length,
        done: p.queue.filter((q) => q.status === "DONE").length,
        absent: p.queue.filter((q) => q.status === "ABSENT").length,
        total: p.queue.length,
      },
      avgMinutes: averageMinutes(p.sessions),
    }));
  }

  async function listPanels(auth: AuthContext, roundId: string) {
    await manageRound(auth, roundId);
    return { panels: await panels(roundId) };
  }

  async function checkMembers(companyId: string, memberIds: string[]) {
    if (!memberIds.length) return;
    const ok = await db.companyMember.count({ where: { companyId, active: true, userId: { in: memberIds } } });
    if (ok !== new Set(memberIds).size) throw new ApiError(400, "NOT_COMPANY_PEOPLE", "Panel members must be HR or interviewers of this company.");
  }

  async function createPanel(auth: AuthContext, roundId: string, body: { name: string; location?: string | null; memberIds: string[] }) {
    const round = await manageRound(auth, roundId);
    if (round.type === "PPT") throw new ApiError(409, "NO_PANELS", "A pre-placement talk has no interview panels.");
    if (round.status === "RESULTS_PUBLISHED" || round.status === "CANCELLED") throw new ApiError(409, "BAD_STATE", "This round is over.");
    await checkMembers(round.drive.companyId, body.memberIds);
    await db.$transaction(async (tx) => {
      const p = await tx.panel.create({ data: { roundId, name: body.name, location: body.location ?? null, members: { create: body.memberIds.map((userId) => ({ userId })) } } });
      await audit(tx, { actorId: auth.userId, action: "panel.created", entityType: "Panel", entityId: p.id, after: { roundId, name: body.name } });
    });
    return { panels: await panels(roundId) };
  }

  async function updatePanel(auth: AuthContext, panelId: string, body: { name?: string; location?: string | null; memberIds?: string[] }) {
    const panel = await db.panel.findUnique({ where: { id: panelId } });
    if (!panel) throw new ApiError(404, "NOT_FOUND", "Panel not found.");
    const round = await manageRound(auth, panel.roundId);
    if (body.memberIds) await checkMembers(round.drive.companyId, body.memberIds);
    await db.$transaction(async (tx) => {
      await tx.panel.update({ where: { id: panelId }, data: { name: body.name, location: body.location } });
      if (body.memberIds) {
        await tx.panelMember.deleteMany({ where: { panelId } });
        await tx.panelMember.createMany({ data: body.memberIds.map((userId) => ({ panelId, userId })) });
      }
      await audit(tx, { actorId: auth.userId, action: "panel.updated", entityType: "Panel", entityId: panelId });
    });
    return { panels: await panels(panel.roundId) };
  }

  async function removePanel(auth: AuthContext, panelId: string) {
    const panel = await db.panel.findUnique({ where: { id: panelId }, include: { queue: { select: { status: true } } } });
    if (!panel) throw new ApiError(404, "NOT_FOUND", "Panel not found.");
    await manageRound(auth, panel.roundId);
    if (panel.queue.some((q) => q.status !== "WAITING")) throw new ApiError(409, "PANEL_IN_USE", "This panel has already called students. It can't be removed.");
    await db.$transaction(async (tx) => {
      await tx.panel.delete({ where: { id: panelId } });
      await audit(tx, { actorId: auth.userId, action: "panel.removed", entityType: "Panel", entityId: panelId });
    });
    return { panels: await panels(panel.roundId) };
  }

  // ───────────── the line ─────────────

  /**
   * Puts students in the round who aren't in a line yet into the panels' lines, a fair share each
   * (the shortest line gets the next student). If the round took attendance, only students who came.
   * Running it again later adds late arrivals.
   */
  async function buildQueue(auth: AuthContext, roundId: string) {
    const round = await manageRound(auth, roundId);
    if (!running(round.status)) throw new ApiError(409, "ROUND_NOT_RUNNING", "Start the round before making the line.");
    const ps = await db.panel.findMany({ where: { roundId }, orderBy: { createdAt: "asc" }, include: { queue: { select: { position: true, status: true } } } });
    if (!ps.length) throw new ApiError(409, "NO_PANELS", "Add at least one panel first.");
    const tookAttendance = (await db.attendanceSession.count({ where: { roundId } })) > 0;
    const candidates = await db.participation.findMany({
      where: {
        driveId: round.driveId,
        status: "OPTED_IN",
        queueEntries: { none: { panel: { roundId } } },
        ...(tookAttendance ? { attendance: { some: { roundId } } } : {}),
      },
      orderBy: { student: { rollNo: "asc" } },
      select: { id: true },
    });
    const load = ps.map((p) => ({ id: p.id, open: p.queue.filter((q) => q.status === "WAITING" || (LIVE as readonly string[]).includes(q.status)).length, next: Math.max(0, ...p.queue.map((q) => q.position)) + 1 }));
    await db.$transaction(async (tx) => {
      for (const c of candidates) {
        const target = load.reduce((a, b) => (b.open < a.open ? b : a));
        await tx.queueEntry.create({ data: { panelId: target.id, participationId: c.id, position: target.next } });
        target.open += 1;
        target.next += 1;
      }
      await audit(tx, { actorId: auth.userId, action: "queue.built", entityType: "Round", entityId: roundId, after: { added: candidates.length } });
      if (candidates.length) await emit(tx, "queue.updated", { roundId });
    });
    return { added: candidates.length, panels: await panels(roundId) };
  }

  /** Move a waiting student to another panel's line (to the end). */
  async function move(auth: AuthContext, entryId: string, panelId: string) {
    const { entry, panel } = await entryOf(auth, entryId);
    await manageRound(auth, panel.roundId);
    if (entry.status !== "WAITING") throw new ApiError(409, "NOT_WAITING", "Only a waiting student can be moved.");
    const target = await db.panel.findUnique({ where: { id: panelId } });
    if (!target || target.roundId !== panel.roundId) throw new ApiError(400, "OTHER_ROUND", "Pick a panel of the same round.");
    await db.$transaction(async (tx) => {
      await lockPanel(tx, panelId);
      const last = await tx.queueEntry.aggregate({ where: { panelId }, _max: { position: true } });
      await tx.queueEntry.update({ where: { id: entryId }, data: { panelId, position: (last._max.position ?? 0) + 1 } });
      await audit(tx, { actorId: auth.userId, action: "queue.moved", entityType: "QueueEntry", entityId: entryId, after: { panelId } });
      await emit(tx, "queue.updated", { roundId: panel.roundId });
    });
    return panelView(auth, panel.id);
  }

  // ───────────── running a panel ─────────────

  /** One panel's screen: who is in the room or called, the waiting line and the finished interviews. */
  async function panelView(auth: AuthContext, panelId: string) {
    const panel = await runPanel(auth, panelId);
    const entries = await db.queueEntry.findMany({
      where: { panelId },
      orderBy: { position: "asc" },
      include: {
        participation: { select: { id: true, student: { select: { id: true, name: true, rollNo: true, branch: true, batch: true, cgpa: true, activeBacklogs: true, skills: true, links: true, resumeFileId: true } } } },
        session: { select: { id: true, startedAt: true, endedAt: true, privateNotes: true, recommendation: true, interviewerId: true } },
      },
    });
    const sessions = await db.interviewSession.findMany({ where: { panelId }, select: { startedAt: true, endedAt: true } });
    const feedback = await db.feedback.findMany({ where: { roundId: panel.roundId, participationId: { in: entries.map((e) => e.participationId) } }, select: { participationId: true, text: true, status: true } });
    const fb = new Map(feedback.map((f) => [f.participationId, f]));
    const row = (e: (typeof entries)[number]) => ({
      id: e.id,
      status: e.status,
      position: e.position,
      skipCount: e.skipCount,
      calledAt: e.calledAt,
      student: e.participation.student,
      session: e.session,
      feedback: fb.get(e.participationId) ?? null,
    });
    const current = entries.find((e) => (LIVE as readonly string[]).includes(e.status));
    return {
      id: panel.id,
      name: panel.name,
      location: panel.location,
      round: { id: panel.roundId, title: panel.round.title, status: panel.round.status, driveId: panel.round.driveId, roleTitle: panel.round.drive.roleTitle, company: panel.round.drive.company.name },
      running: running(panel.round.status),
      avgMinutes: averageMinutes(sessions),
      current: current ? row(current) : null,
      waiting: entries.filter((e) => e.status === "WAITING").map(row),
      done: entries.filter((e) => e.status === "DONE" || e.status === "ABSENT").map(row),
    };
  }

  /** Panels the signed-in interviewer (or HR) sits on, in rounds that are running now. */
  async function myPanels(auth: AuthContext) {
    const list = await db.panel.findMany({
      where: { members: { some: { userId: auth.userId } }, round: { status: { in: ["IN_PROGRESS", "RESULTS_PENDING", "SCHEDULED"] } } },
      orderBy: { createdAt: "asc" },
      include: { round: { select: { title: true, status: true, startsAt: true, drive: { select: { roleTitle: true, company: { select: { name: true } } } } } }, queue: { select: { status: true } } },
    });
    return {
      panels: list.map((p) => ({
        id: p.id,
        name: p.name,
        location: p.location,
        round: { title: p.round.title, status: p.round.status, startsAt: p.round.startsAt, roleTitle: p.round.drive.roleTitle, company: p.round.drive.company.name },
        waiting: p.queue.filter((q) => q.status === "WAITING").length,
        done: p.queue.filter((q) => q.status === "DONE").length,
      })),
    };
  }

  async function callNext(auth: AuthContext, panelId: string) {
    const panel = await runPanel(auth, panelId);
    if (!running(panel.round.status)) throw new ApiError(409, "ROUND_NOT_RUNNING", "This round isn't running.");
    const email = await db.$transaction(async (tx) => {
      await lockPanel(tx, panelId);
      const busy = await tx.queueEntry.findFirst({ where: { panelId, status: { in: [...LIVE] } } });
      if (busy) throw new ApiError(409, "PANEL_BUSY", "Finish or skip the current student first.");
      const next = await tx.queueEntry.findFirst({ where: { panelId, status: "WAITING" }, orderBy: { position: "asc" } });
      if (!next) throw new ApiError(409, "LINE_EMPTY", "No one is waiting for this panel.");
      await tx.queueEntry.update({ where: { id: next.id }, data: { status: "CALLED", calledAt: new Date(now()) } });
      await audit(tx, { actorId: auth.userId, action: "queue.called", entityType: "QueueEntry", entityId: next.id });
      await emit(tx, "queue.called", { panelId, participationId: next.participationId });
      return tellStudent(tx, next.participationId, `Your turn: ${panel.name}`, `Go to ${panel.location ?? panel.name} now for ${panel.round.title} (${panel.round.drive.company.name}).`, panel.round.driveId);
    });
    await sendAfterCommit(mailer, [email]);
    return panelView(auth, panelId);
  }

  async function startInterview(auth: AuthContext, entryId: string) {
    const { entry, panel } = await entryOf(auth, entryId);
    if (entry.status !== "CALLED") throw new ApiError(409, "NOT_CALLED", "Call the student before starting.");
    await db.$transaction(async (tx) => {
      await tx.queueEntry.update({ where: { id: entryId }, data: { status: "IN_INTERVIEW" } });
      await tx.interviewSession.create({ data: { queueEntryId: entryId, panelId: panel.id, interviewerId: auth.userId, startedAt: new Date(now()) } });
      await emit(tx, "interview.started", { panelId: panel.id, participationId: entry.participationId });
    });
    return panelView(auth, panel.id);
  }

  /**
   * Ends the interview. Private notes and the recommendation stay with the company and the TPO.
   * A remark for the student waits for the TPO's check before the student sees it.
   */
  async function endInterview(auth: AuthContext, entryId: string, body: { privateNotes?: string | null; recommendation?: "SELECT" | "REJECT" | "HOLD" | null; feedback?: string | null }) {
    const { entry, panel } = await entryOf(auth, entryId);
    if (entry.status !== "IN_INTERVIEW") throw new ApiError(409, "NOT_IN_INTERVIEW", "This interview hasn't started.");
    await db.$transaction(async (tx) => {
      await tx.queueEntry.update({ where: { id: entryId }, data: { status: "DONE" } });
      await tx.interviewSession.update({
        where: { queueEntryId: entryId },
        data: { endedAt: new Date(now()), privateNotes: body.privateNotes ?? null, recommendation: body.recommendation ?? null },
      });
      if (body.feedback?.trim()) {
        await tx.feedback.create({ data: { participationId: entry.participationId, roundId: panel.roundId, authorId: auth.userId, text: body.feedback.trim() } });
      }
      await audit(tx, { actorId: auth.userId, action: "interview.ended", entityType: "QueueEntry", entityId: entryId, after: { recommendation: body.recommendation ?? null } });
      await emit(tx, "interview.ended", { panelId: panel.id, participationId: entry.participationId });
    });
    return panelView(auth, panel.id);
  }

  /** Not there when called: to the end of the line. After MAX_SKIPS skips, marked absent from the line. */
  async function skip(auth: AuthContext, entryId: string) {
    const { entry, panel } = await entryOf(auth, entryId);
    if (entry.status !== "CALLED" && entry.status !== "WAITING") throw new ApiError(409, "CANT_SKIP", "Only a waiting or called student can be skipped.");
    const email = await db.$transaction(async (tx) => {
      await lockPanel(tx, panel.id);
      const skips = entry.skipCount + 1;
      if (skips >= MAX_SKIPS) {
        await tx.queueEntry.update({ where: { id: entryId }, data: { status: "ABSENT", skipCount: skips } });
        await audit(tx, { actorId: auth.userId, action: "queue.absent", entityType: "QueueEntry", entityId: entryId });
        await emit(tx, "queue.updated", { roundId: panel.roundId });
        return tellStudent(tx, entry.participationId, `Missed your turn: ${panel.name}`, `You weren't there when called twice, so you've been marked absent from the interview line. Go to the placement office at the venue now if you are here.`, panel.round.driveId);
      }
      const last = await tx.queueEntry.aggregate({ where: { panelId: panel.id }, _max: { position: true } });
      await tx.queueEntry.update({ where: { id: entryId }, data: { status: "WAITING", skipCount: skips, calledAt: null, position: (last._max.position ?? 0) + 1 } });
      await audit(tx, { actorId: auth.userId, action: "queue.skipped", entityType: "QueueEntry", entityId: entryId });
      await emit(tx, "queue.updated", { roundId: panel.roundId });
      return tellStudent(tx, entry.participationId, `Moved to the end of the line: ${panel.name}`, `You weren't there when called, so you've been moved to the end of the line. Stay near ${panel.location ?? "the panel"}.`, panel.round.driveId);
    });
    await sendAfterCommit(mailer, [email]);
    return panelView(auth, panel.id);
  }

  /** Put an absent-from-line student back at the end (they turned up). */
  async function requeue(auth: AuthContext, entryId: string) {
    const { entry, panel } = await entryOf(auth, entryId);
    if (entry.status !== "ABSENT") throw new ApiError(409, "NOT_ABSENT", "This student is not marked absent.");
    await db.$transaction(async (tx) => {
      await lockPanel(tx, panel.id);
      const last = await tx.queueEntry.aggregate({ where: { panelId: panel.id }, _max: { position: true } });
      await tx.queueEntry.update({ where: { id: entryId }, data: { status: "WAITING", position: (last._max.position ?? 0) + 1 } });
      await audit(tx, { actorId: auth.userId, action: "queue.requeued", entityType: "QueueEntry", entityId: entryId });
    });
    return panelView(auth, panel.id);
  }

  // ───────────── what the round page and the student see ─────────────

  /** Per student in a round: the panels' recommendations and notes (for HR's final decision). */
  async function interviewsOf(auth: AuthContext, roundId: string) {
    await manageRound(auth, roundId);
    const rows = await db.queueEntry.findMany({
      where: { panel: { roundId } },
      select: { participationId: true, status: true, panel: { select: { name: true } }, session: { select: { privateNotes: true, recommendation: true, endedAt: true } } },
    });
    return {
      interviews: rows.map((r) => ({ participationId: r.participationId, panel: r.panel.name, status: r.status, recommendation: r.session?.recommendation ?? null, privateNotes: r.session?.privateNotes ?? null })),
    };
  }

  /** The student's place in a running round's line: panel, room, position and a wait estimate. */
  async function myLine(participationId: string) {
    const entries = await db.queueEntry.findMany({
      where: { participationId, panel: { round: { status: { in: ["IN_PROGRESS", "RESULTS_PENDING"] } } } },
      include: { panel: { include: { round: { select: { id: true } }, sessions: { select: { startedAt: true, endedAt: true } } } } },
    });
    const out = [];
    for (const e of entries) {
      const ahead = e.status === "WAITING" ? await db.queueEntry.count({ where: { panelId: e.panelId, status: "WAITING", position: { lt: e.position } } }) : 0;
      const someoneIn = await db.queueEntry.count({ where: { panelId: e.panelId, status: { in: [...LIVE] }, NOT: { id: e.id } } });
      const avg = averageMinutes(e.panel.sessions);
      out.push({
        roundId: e.panel.round.id,
        panel: e.panel.name,
        location: e.panel.location,
        status: e.status,
        position: e.status === "WAITING" ? ahead + 1 : null,
        waitMinutes: e.status === "WAITING" ? (ahead + someoneIn) * avg : null,
      });
    }
    return out;
  }

  // ───────────── feedback for students (TPO checks first) ─────────────

  async function feedbackForDrive(auth: AuthContext, driveId: string) {
    if (!auth.has("TPO")) throw new ApiError(403, "FORBIDDEN", "Only the TPO checks feedback.");
    const rows = await db.feedback.findMany({
      where: { participation: { driveId } },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: { participation: { select: { student: { select: { name: true, rollNo: true } } } } },
    });
    const rounds = await db.round.findMany({ where: { driveId }, select: { id: true, title: true } });
    const authors = await db.user.findMany({ where: { id: { in: rows.map((r) => r.authorId) } }, select: { id: true, name: true, email: true } });
    return {
      feedback: rows.map((f) => ({
        id: f.id,
        student: f.participation.student,
        round: rounds.find((r) => r.id === f.roundId)?.title ?? null,
        author: authors.find((a) => a.id === f.authorId)?.name ?? authors.find((a) => a.id === f.authorId)?.email ?? null,
        text: f.text,
        releasedText: f.releasedText,
        status: f.status,
        createdAt: f.createdAt,
      })),
    };
  }

  async function reviewFeedback(auth: AuthContext, id: string, body: { action: "RELEASE" | "WITHHOLD"; text?: string | null }) {
    const f = await db.feedback.findUnique({ where: { id }, include: { participation: { select: { driveId: true, student: { select: { userId: true } }, drive: { select: { company: { select: { name: true } } } } } } } });
    if (!f) throw new ApiError(404, "NOT_FOUND", "Feedback not found.");
    if (f.status !== "PENDING_REVIEW") throw new ApiError(409, "ALREADY_REVIEWED", "This feedback was already checked.");
    const edited = body.action === "RELEASE" && body.text != null && body.text.trim() !== f.text;
    const email = await db.$transaction(async (tx) => {
      await tx.feedback.update({
        where: { id },
        data: {
          status: body.action === "WITHHOLD" ? "WITHHELD" : edited ? "EDITED_AND_RELEASED" : "RELEASED",
          releasedText: body.action === "RELEASE" ? (edited ? body.text!.trim() : f.text) : null,
          reviewedById: auth.userId,
          reviewedAt: new Date(now()),
        },
      });
      await audit(tx, { actorId: auth.userId, action: body.action === "RELEASE" ? "feedback.released" : "feedback.withheld", entityType: "Feedback", entityId: id });
      if (body.action !== "RELEASE") return null;
      await emit(tx, "feedback.released", { participationId: f.participationId });
      return notifyInApp(tx, {
        userId: f.participation.student.userId,
        channel: "DRIVES",
        title: `${f.participation.drive.company.name}: feedback from your interview`,
        body: "The interview panel left a remark for you. Open the drive to read it.",
        link: link(`/student/drives/${f.participation.driveId}`),
      });
    });
    if (email) await sendAfterCommit(mailer, [email]);
    return feedbackForDrive(auth, f.participation.driveId);
  }

  return {
    people,
    listPanels,
    createPanel,
    updatePanel,
    removePanel,
    buildQueue,
    move,
    panelView,
    myPanels,
    callNext,
    startInterview,
    endInterview,
    skip,
    requeue,
    interviewsOf,
    myLine,
    feedbackForDrive,
    reviewFeedback,
  };
}

export type InterviewsService = ReturnType<typeof createInterviewsService>;
