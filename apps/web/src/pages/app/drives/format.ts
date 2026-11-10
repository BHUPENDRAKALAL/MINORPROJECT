import { JOB_TYPE_LABELS, ROUND_KINDS, type DriveStatus, type Eligibility, type JobType, type ParticipationStatus, type Role, type RoundType } from "@cyrus/shared";
import type { Tone } from "../../../components/kit";
import type { Round } from "../../../lib/api";

/** Where the drive pages live for this role (HR's drives are their home page). */
export function drivePaths(role: Role | null) {
  const hr = role === "COMPANY_HR";
  const base = hr ? "/company/drives" : "/office/drives";
  return {
    list: hr ? "/company" : "/office/drives",
    create: `${base}/new`,
    item: (id: string) => `${base}/${id}`,
    edit: (id: string, step?: string) => `${base}/${id}/edit${step ? `?step=${step}` : ""}`,
    round: (id: string, roundId: string) => `${base}/${id}/rounds/${roundId}`,
  };
}

const TZ = "Asia/Kolkata";

export function when(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "Date to be announced";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", withTime ? { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ } : { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}

/** "3 days left", "5 hours left", "Closed" */
export function timeLeft(iso: string | null): string {
  if (!iso) return "No deadline set";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Joining closed";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "Less than an hour left";
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} left`;
  return `${Math.floor(h / 24)} days left`;
}

/** ISO → value for <input type="datetime-local"> in the viewer's time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export function pay(d: { jobType: JobType; ctcLpa: number | null; stipendMonthly: number | null }): string {
  const parts = [];
  if (d.ctcLpa != null) parts.push(`₹${d.ctcLpa} LPA`);
  if (d.stipendMonthly != null) parts.push(`₹${d.stipendMonthly.toLocaleString("en-IN")}/month`);
  return parts.length ? parts.join(" · ") : "Pay not given";
}

export const jobLabel = (t: JobType) => JOB_TYPE_LABELS[t];

export function eligibilityLines(e: Eligibility): string[] {
  const out: string[] = [];
  out.push(e.branches?.length ? `Branches: ${e.branches.join(", ")}` : "All branches");
  out.push(e.batches?.length ? `Batch: ${e.batches.join(", ")}` : "All batches");
  if (e.minCgpa != null) out.push(`CGPA ${e.minCgpa} or more`);
  if (e.maxActiveBacklogs != null) out.push(e.maxActiveBacklogs === 0 ? "No active backlogs" : `At most ${e.maxActiveBacklogs} active backlogs`);
  if (e.minTenth != null) out.push(`Class 10: ${e.minTenth}% or more`);
  if (e.minTwelfth != null) out.push(`Class 12 / diploma: ${e.minTwelfth}% or more`);
  return out;
}

/**
 * Keeps default names in order: after a move or a removal, "Technical round 3" that is now the
 * second technical round becomes "Technical round 2". Names the user typed are left alone.
 */
export function renumber(rounds: Round[]): Round[] {
  const seen: Partial<Record<RoundType, number>> = {};
  return rounds.map((r) => {
    const kind = ROUND_KINDS[r.type];
    if (!kind.numbered) return r;
    const n = (seen[r.type] = (seen[r.type] ?? 0) + 1);
    const isDefaultName = r.title.startsWith(`${kind.title} `) && /^\d+$/.test(r.title.slice(kind.title.length + 1));
    return isDefaultName ? { ...r, title: `${kind.title} ${n}` } : r;
  });
}

/** Opens a short-lived link in a new tab (the link itself is never stored). */
export async function openLink(get: () => Promise<{ url: string }>) {
  const w = window.open("", "_blank");
  try {
    const { url } = await get();
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}

/** The dot colour for a student's place in a drive (kit Badge tones). */
export const PARTICIPATION_TONE: Record<ParticipationStatus, Tone> = {
  INVITED: "warning",
  OPTED_IN: "success",
  OPTED_OUT: "neutral",
  EXPIRED: "neutral",
  ELIMINATED: "danger",
  NO_SHOW: "danger",
  SELECTED: "success",
  OFFERED: "accent",
  PLACED: "accent",
  OFFER_DECLINED: "neutral",
  REMOVED: "neutral",
};

/** True while the drive still needs something from the student or is still running for them. */
export const isActiveForStudent = (s: ParticipationStatus, drive: DriveStatus) =>
  drive !== "CANCELLED" && drive !== "CLOSED" && ["INVITED", "OPTED_IN", "SELECTED", "OFFERED"].includes(s);
