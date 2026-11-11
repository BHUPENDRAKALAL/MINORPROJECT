import type { Eligibility } from "@cyrus/shared";
import type { Db } from "../../lib/db.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

/**
 * Clash check for drives (BACKEND-DESIGN: campus schedule). Finds, for one drive:
 *   high    the same venue booked at an overlapping time by another drive
 *   high    students who could be in both drives have rounds at overlapping times
 *   medium  a busy day: two or more other drives already have rounds that day
 *   medium  two drives with shared students close joining on the same day
 * A round without an end time is taken to last two hours. Only drives that are waiting for approval
 * or live count (drafts, cancelled and finished drives don't).
 */

const DEFAULT_ROUND_MS = 2 * 60 * 60 * 1000;
const LIVE = ["PENDING_APPROVAL", "PUBLISHED", "ONGOING"] as const;
/** Participations that still take a student's time. */
const ACTIVE_PART = ["INVITED", "OPTED_IN", "SELECTED", "OFFERED"] as const;
const BUSY_DAY_AT = 2;

export type Severity = "high" | "medium";
export type ClashKind = "venue" | "students" | "busy_day" | "deadline";

export interface Clash {
  severity: Severity;
  kind: ClashKind;
  /** This drive's round (null for the joining-deadline clash) */
  round: { id: string | null; title: string; start: string | null; end: string | null; venue: string | null } | null;
  /** The other drive (names are for the TPO only; HR gets anonymous hints) */
  other: { driveId: string; company: string; roleTitle: string; roundTitle: string | null; start: string | null; end: string | null; venue: string | null } | null;
  /** How many students the two drives share (students clash) */
  shared?: number;
  /** How many other drives have rounds that day (busy day) */
  count?: number;
  day: string;
}

export interface Slot {
  id: string | null;
  title: string;
  mode: "OFFLINE" | "ONLINE";
  startsAt: Date | null;
  endsAt: Date | null;
  venue: string | null;
}

type EligibleWhere = (e: Eligibility, ctcLpa: number | null) => Promise<Prisma.StudentProfileWhereInput>;

const windowOf = (s: { startsAt: Date | null; endsAt: Date | null }) =>
  s.startsAt ? { start: s.startsAt, end: s.endsAt && s.endsAt > s.startsAt ? s.endsAt : new Date(s.startsAt.getTime() + DEFAULT_ROUND_MS) } : null;
const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;
const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** The calendar day in India, so "the same day" matches what people see. */
export const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function createClashes(db: Db, eligibleWhere: EligibleWhere) {
  /** The students a drive takes time from: everyone still in it, or (before invites) everyone who matches its rules. */
  async function poolOf(drive: { id: string; eligibility: Prisma.JsonValue; ctcLpa: number | null }): Promise<Set<string>> {
    const parts = await db.participation.findMany({ where: { driveId: drive.id, status: { in: [...ACTIVE_PART] } }, select: { studentId: true } });
    if (parts.length) return new Set(parts.map((p) => p.studentId));
    const where = await eligibleWhere((drive.eligibility ?? {}) as Eligibility, drive.ctcLpa);
    const rows = await db.studentProfile.findMany({ where, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Checks `slots` (this drive's rounds, saved or proposed) against every other live drive.
   * `slots` defaults to the drive's saved rounds.
   */
  async function check(driveId: string, slots?: Slot[]): Promise<Clash[]> {
    const drive = await db.drive.findUniqueOrThrow({
      where: { id: driveId },
      select: { id: true, eligibility: true, ctcLpa: true, optInDeadline: true, rounds: { orderBy: { sequence: "asc" }, select: { id: true, title: true, mode: true, startsAt: true, endsAt: true, venue: true, status: true } } },
    });
    const mine: Slot[] = slots ?? drive.rounds.filter((r) => r.status !== "CANCELLED" && r.status !== "RESULTS_PUBLISHED");
    const others = await db.drive.findMany({
      where: { id: { not: driveId }, status: { in: [...LIVE] } },
      select: {
        id: true,
        roleTitle: true,
        eligibility: true,
        ctcLpa: true,
        optInDeadline: true,
        company: { select: { name: true } },
        rounds: { where: { startsAt: { not: null }, status: { in: ["SCHEDULED", "IN_PROGRESS"] } }, select: { id: true, title: true, mode: true, startsAt: true, endsAt: true, venue: true } },
      },
    });

    let myPool: Set<string> | null = null;
    const pools = new Map<string, Set<string>>();
    const shared = async (o: (typeof others)[number]) => {
      myPool ??= await poolOf(drive);
      if (!pools.has(o.id)) pools.set(o.id, await poolOf(o));
      const theirs = pools.get(o.id)!;
      let n = 0;
      for (const s of myPool) if (theirs.has(s)) n++;
      return n;
    };

    const out: Clash[] = [];
    for (const r of mine) {
      const w = windowOf(r);
      if (!w) continue;
      const day = dayOf(w.start);
      const sameDay = new Set<string>();
      for (const o of others) {
        for (const or of o.rounds) {
          const ow = windowOf(or)!;
          if (dayOf(ow.start) === day) sameDay.add(o.id);
          if (!overlaps(w, ow)) continue;
          const other = { driveId: o.id, company: o.company.name, roleTitle: o.roleTitle, roundTitle: or.title, start: iso(ow.start), end: iso(ow.end), venue: or.venue };
          const round = { id: r.id, title: r.title, start: iso(w.start), end: iso(w.end), venue: r.venue };
          if (r.mode === "OFFLINE" && or.mode === "OFFLINE" && norm(r.venue) && norm(r.venue) === norm(or.venue)) {
            out.push({ severity: "high", kind: "venue", round, other, day });
          }
          const n = await shared(o);
          if (n > 0) out.push({ severity: "high", kind: "students", round, other, shared: n, day });
        }
      }
      if (sameDay.size >= BUSY_DAY_AT) out.push({ severity: "medium", kind: "busy_day", round: { id: r.id, title: r.title, start: iso(w.start), end: iso(w.end), venue: r.venue }, other: null, count: sameDay.size, day });
    }

    if (drive.optInDeadline) {
      const day = dayOf(drive.optInDeadline);
      for (const o of others) {
        if (!o.optInDeadline || dayOf(o.optInDeadline) !== day) continue;
        const n = await shared(o);
        if (n > 0) out.push({ severity: "medium", kind: "deadline", round: null, other: { driveId: o.id, company: o.company.name, roleTitle: o.roleTitle, roundTitle: null, start: iso(o.optInDeadline), end: null, venue: null }, shared: n, day });
      }
    }
    return out.sort((a, b) => (a.severity === b.severity ? (a.round?.start ?? a.day).localeCompare(b.round?.start ?? b.day) : a.severity === "high" ? -1 : 1));
  }

  /** The same check, worded for HR: no other company's name, role or venue. */
  function forHr(clashes: Clash[]) {
    const time = (s: string | null) => (s ? new Date(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");
    return clashes.map((c) => ({
      severity: c.severity,
      kind: c.kind,
      roundTitle: c.round?.title ?? null,
      message:
        c.kind === "venue"
          ? `${c.round!.venue} is already booked ${time(c.other!.start)}–${time(c.other!.end)} by another drive.`
          : c.kind === "students"
            ? `${c.shared} student${c.shared === 1 ? "" : "s"} who could join have another round ${time(c.other!.start)}–${time(c.other!.end)}.`
            : c.kind === "busy_day"
              ? `Campus is busy that day: ${c.count} other drives have rounds.`
              : `Another drive with ${c.shared} of the same students closes joining that day.`,
    }));
  }

  return { check, forHr };
}

export type ClashChecker = ReturnType<typeof createClashes>;
