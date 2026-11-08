/** Drive and round vocabulary, shared by the API and the web app (PLAN.md §3, BACKEND-DESIGN.md §9.6). */

export const DRIVE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "PUBLISHED", "ONGOING", "RESULTS_DECLARED", "CLOSED", "REJECTED", "CANCELLED"] as const;
export type DriveStatus = (typeof DRIVE_STATUSES)[number];

export const DRIVE_STATUS_LABELS: Record<DriveStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for TPO approval",
  PUBLISHED: "Open",
  ONGOING: "Rounds in progress",
  RESULTS_DECLARED: "Results out",
  CLOSED: "Closed",
  REJECTED: "Sent back by the TPO",
  CANCELLED: "Cancelled",
};

/** Drives students can know about (they see only the name and role unless they are in the drive). */
export const VISIBLE_DRIVE_STATUSES = ["PUBLISHED", "ONGOING", "RESULTS_DECLARED", "CLOSED"] as const satisfies readonly DriveStatus[];
/** HR or the TPO can still change everything. */
export const EDITABLE_DRIVE_STATUSES = ["DRAFT", "REJECTED"] as const satisfies readonly DriveStatus[];
/** Students can be invited and can join or skip. */
export const OPEN_DRIVE_STATUSES = ["PUBLISHED", "ONGOING"] as const satisfies readonly DriveStatus[];

export const JOB_TYPES = ["FULL_TIME", "INTERNSHIP", "INTERNSHIP_PPO"] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  FULL_TIME: "Full-time",
  INTERNSHIP: "Internship",
  INTERNSHIP_PPO: "Internship + PPO",
};

export const ROUND_TYPES = ["PPT", "OA", "GD", "TECHNICAL", "INTERVIEW", "HR", "OTHER"] as const;
export type RoundType = (typeof ROUND_TYPES)[number];

export interface RoundKind {
  /** Chip text in the round builder */
  label: string;
  /** Name given to a new round of this kind. Numbered kinds get " 1", " 2"… */
  title: string;
  numbered: boolean;
  /** One line shown under the chip / on the card */
  hint: string;
}

export const ROUND_KINDS: Record<RoundType, RoundKind> = {
  PPT: { label: "Pre-placement talk", title: "Pre-placement talk", numbered: false, hint: "Company talk. Attendance only, no result." },
  OA: { label: "Online assessment", title: "Online assessment", numbered: false, hint: "Test on a platform. Results typed in or uploaded as CSV." },
  GD: { label: "Group discussion", title: "Group discussion", numbered: false, hint: "Students in groups. Pass or fail per student." },
  TECHNICAL: { label: "Technical round", title: "Technical round", numbered: true, hint: "Coding or technical test. Can repeat: round 1, 2, 3…" },
  INTERVIEW: { label: "Interview", title: "Interview round", numbered: true, hint: "One-to-one with panels and a live waiting line. Can repeat." },
  HR: { label: "HR round", title: "HR round", numbered: false, hint: "Final talk with HR, usually the last round." },
  OTHER: { label: "Other", title: "", numbered: false, hint: "Anything else. Give it your own name." },
};

/** Name for the next round of a kind, given the rounds already in the drive. */
export function nextRoundTitle(type: RoundType, existing: { type: RoundType }[]): string {
  const kind = ROUND_KINDS[type];
  if (!kind.numbered) return kind.title;
  const n = existing.filter((r) => r.type === type).length + 1;
  return `${kind.title} ${n}`;
}

/** One-click starting points for the round builder. */
export const ROUND_TEMPLATES: { name: string; types: RoundType[] }[] = [
  { name: "OA → Technical → HR", types: ["OA", "TECHNICAL", "HR"] },
  { name: "OA → Technical 1 → Technical 2 → HR", types: ["OA", "TECHNICAL", "TECHNICAL", "HR"] },
  { name: "PPT → OA → GD → Interview → HR", types: ["PPT", "OA", "GD", "INTERVIEW", "HR"] },
  { name: "OA → Interview 1 → Interview 2 → Interview 3", types: ["OA", "INTERVIEW", "INTERVIEW", "INTERVIEW"] },
];

export const MAX_ROUNDS = 12;

export const PARTICIPATION_LABELS = {
  INVITED: "Invited",
  OPTED_IN: "Joined",
  OPTED_OUT: "Skipped",
  EXPIRED: "Missed the deadline",
  ELIMINATED: "Not selected",
  NO_SHOW: "Absent",
  SELECTED: "Selected",
  OFFERED: "Offer received",
  PLACED: "Placed",
  OFFER_DECLINED: "Offer declined",
  REMOVED: "Removed",
} as const;
export type ParticipationStatus = keyof typeof PARTICIPATION_LABELS;

/** Who may apply. Every field is optional; an empty object means "every verified student". */
export interface Eligibility {
  branches?: string[];
  batches?: number[];
  minCgpa?: number;
  maxActiveBacklogs?: number;
  minTenth?: number;
  minTwelfth?: number;
}

/** The check-in QR on the venue screen changes this often (seconds). The current and the previous code are accepted. */
export const QR_WINDOW_SECONDS = 15;

export const RESULT_LABELS = {
  PENDING: "No result yet",
  SELECTED: "Selected",
  REJECTED: "Not selected",
  ON_HOLD: "On hold",
} as const;
export type ResultValue = keyof typeof RESULT_LABELS;
