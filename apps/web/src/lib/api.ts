import type { Criterion, DriveStatus, Eligibility, JobType, ParticipationStatus, ResultValue, Role, RoundType } from "@cyrus/shared";
import { APP_NAME } from "./brand";

/** Base URL of the API. Empty in the browser dev server (Vite forwards /api); set VITE_API_URL for Tauri builds. */
const BASE = import.meta.env.VITE_API_URL ?? "";
const PREFIX = "/api/v1";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

interface ValidationIssue {
  path: string;
  message: string;
}

/** Every failed request becomes this. `message` is written for end users, so it can be shown as is. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field messages from a VALIDATION_FAILED response, keyed by field path (e.g. "email"). First message per field wins. */
  get fieldErrors(): Record<string, string> {
    const issues = (this.details as { issues?: ValidationIssue[] } | undefined)?.issues;
    const out: Record<string, string> = {};
    if (Array.isArray(issues)) {
      for (const i of issues) {
        const key = i.path || "_";
        if (!(key in out)) out[key] = i.message;
      }
    }
    return out;
  }
}


export const NETWORK_ERROR_MESSAGE = `Can't reach ${APP_NAME} right now. Check your connection and try again.`;

// ---------------------------------------------------------------------------
// Types returned by the auth API
// ---------------------------------------------------------------------------

export interface Tokens {
  accessToken: string;
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: number;
  user: { id: string; email: string; name: string | null; roles: Role[] };
}

export type StudentStatus = "PROFILE_INCOMPLETE" | "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
export type PlacementStatus = "NOT_PLACED" | "PLACED";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  status: string;
  pledgeAcceptedAt: string | null;
  student: {
    id: string;
    rollNo: string;
    branch: string;
    batch: number;
    status: StudentStatus;
    placementStatus: PlacementStatus;
  } | null;
  companyMembers: { role: string; company: { id: string; name: string; status: string } }[];
  roles: Role[];
}

export interface InviteInfo {
  email: string;
  role: Role;
  companyName: string | null;
  hasAccount: boolean;
}

// ---------------------------------------------------------------------------
// Session: the access token lives in memory only. The refresh token is an httpOnly cookie.
// ---------------------------------------------------------------------------

interface SessionState {
  accessToken: string | null;
  /** Epoch ms when the access token expires. */
  expiresAt: number | null;
}

let session: SessionState = { accessToken: null, expiresAt: null };
const sessionListeners = new Set<(s: SessionState) => void>();
const lostListeners = new Set<() => void>();
let refreshInFlight: Promise<Tokens | null> | null = null;

export function getSession(): SessionState {
  return session;
}

export function setSessionFromTokens(t: Tokens): void {
  session = { accessToken: t.accessToken, expiresAt: Date.now() + t.accessTokenExpiresIn * 1000 };
  sessionListeners.forEach((l) => l(session));
}

export function clearSession(): void {
  session = { accessToken: null, expiresAt: null };
  sessionListeners.forEach((l) => l(session));
}

/** Called whenever the access token changes (sign-in, refresh, sign-out). */
export function onSessionChange(fn: (s: SessionState) => void): () => void {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

/** Called when a request needed a session and the refresh failed: the person has to sign in again. */
export function onSessionLost(fn: () => void): () => void {
  lostListeners.add(fn);
  return () => lostListeners.delete(fn);
}

/**
 * Gets a new access token from the refresh cookie. Concurrent callers share one request,
 * because the server rotates the refresh token and a second parallel call would use a spent one.
 * Resolves to null (and clears the session) when the session has ended.
 */
export function refreshSession(): Promise<Tokens | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}${PREFIX}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        clearSession();
        return null;
      }
      const tokens = (await res.json()) as Tokens;
      setSessionFromTokens(tokens);
      return tokens;
    } catch {
      // Network trouble is not a signed-out session: keep whatever we had and let the caller decide.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Test helper: forget the in-memory session and any refresh in flight. */
export function resetSessionForTests(): void {
  session = { accessToken: null, expiresAt: null };
  refreshInFlight = null;
  sessionListeners.clear();
  lostListeners.clear();
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const SESSION_CODES = new Set(["TOKEN_INVALID", "SESSION_ENDED"]);

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Multipart upload instead of a JSON body. */
  form?: FormData;
  /** Send the access token and refresh on 401. Defaults to true. Public auth routes pass false. */
  auth?: boolean;
  /** Return the parsed body for these non-2xx statuses instead of throwing (used by /ready). */
  allowStatus?: number[];
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
  if (opts.auth !== false && session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  try {
    return await fetch(`${BASE}${PREFIX}${path}`, {
      method: opts.method ?? "GET",
      credentials: "include",
      headers,
      body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
  }
}

async function readError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => undefined)) as ApiErrorBody | undefined;
  if (body?.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  return new ApiError(res.status, "HTTP_" + res.status, "Something went wrong. Please try again.");
}

/**
 * Calls /api/v1{path}. For authenticated calls, a 401 TOKEN_INVALID or SESSION_ENDED triggers one
 * refresh (shared with any other caller) and one retry. If the refresh fails, session-lost listeners
 * run (the app sends the person to sign-in) and the original error is thrown.
 */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const useAuth = opts.auth !== false;
  let res = await send(path, opts);

  if (useAuth && res.status === 401) {
    const err = await readError(res);
    if (!SESSION_CODES.has(err.code)) throw err;
    const tokens = await refreshSession();
    if (!tokens) {
      clearSession();
      lostListeners.forEach((l) => l());
      throw err;
    }
    res = await send(path, opts);
    if (res.status === 401) {
      const again = await readError(res);
      clearSession();
      lostListeners.forEach((l) => l());
      throw again;
    }
  }

  if (!res.ok && !(opts.allowStatus ?? []).includes(res.status)) throw await readError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Small GET used by the system status page. */
export function apiGet<T>(path: string, allowStatus: number[] = []): Promise<T> {
  return api<T>(path, { auth: false, allowStatus });
}

// ---------------------------------------------------------------------------
// Typed helpers
// ---------------------------------------------------------------------------

export interface StudentSignup {
  email: string;
  password: string;
  rollNo: string;
  name: string;
  branch: string;
  batch: number;
}

export const authApi = {
  signup: (body: StudentSignup) =>
    api<{ email: string; next: "verify-email" }>("/auth/student/signup", { method: "POST", body, auth: false }),
  verifyEmail: (email: string, code: string) =>
    api<Tokens>("/auth/student/verify-email", { method: "POST", body: { email, code }, auth: false }),
  resendCode: (email: string) => api<void>("/auth/student/resend-code", { method: "POST", body: { email }, auth: false }),
  login: (email: string, password: string) =>
    api<Tokens>("/auth/login", { method: "POST", body: { email, password }, auth: false }),
  logout: () => api<void>("/auth/logout", { method: "POST", auth: false }),
  forgotPassword: (email: string) => api<void>("/auth/password/forgot", { method: "POST", body: { email }, auth: false }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    api<void>("/auth/password/reset", { method: "POST", body: { email, code, newPassword }, auth: false }),
  getInvite: (token: string) => api<InviteInfo>(`/auth/invites/${encodeURIComponent(token)}`, { auth: false }),
  acceptInvite: (token: string, body: { name?: string; password: string }) =>
    api<Tokens>(`/auth/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body, auth: false }),
};

export const meApi = {
  get: () => api<Me>("/me"),
  updateMe: (body: { name: string }) => api<Me>("/me", { method: "PATCH", body }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<void>("/me/password", { method: "PATCH", body: { currentPassword, newPassword } }),
};

// ---------------------------------------------------------------------------
// Files, student profile, review queue, team
// ---------------------------------------------------------------------------

export type UploadKind = "MARKSHEET" | "RESUME" | "PHOTO" | "OFFER_LETTER";
export interface UploadedFile {
  id: string;
  kind: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: "PENDING" | "CLEAN" | "INFECTED" | "FAILED";
}

export const filesApi = {
  upload: (kind: UploadKind, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<UploadedFile>(`/files?kind=${kind}`, { method: "POST", form });
  },
  link: (id: string) => api<{ url: string; expiresInSeconds: number }>(`/files/${id}/link`),
};

export interface AcademicRecord {
  id: string;
  cgpa: number;
  activeBacklogs: number;
  totalBacklogs: number;
  tenthPercent: number | null;
  twelfthPercent: number | null;
  diplomaPercent: number | null;
  semester: number | null;
  status: string;
}
export type AcademicInput = Pick<AcademicRecord, "cgpa" | "activeBacklogs" | "totalBacklogs" | "tenthPercent" | "twelfthPercent" | "diplomaPercent" | "semester">;

export interface StudentDocument {
  id: string;
  type: "MARKSHEET_10" | "MARKSHEET_12" | "DIPLOMA" | "SEMESTER_MARKSHEET" | "OTHER";
  semester: number | null;
  status: string;
  flagged: boolean;
  /** scanNote: why the file was refused (shown to the student), or what the cleaning removed */
  file: { id: string; originalName: string; mimeType: string; sizeBytes: number; scanStatus: string; scanNote: string | null };
}

export interface StudentProfileView {
  profile: {
    id: string;
    rollNo: string;
    name: string;
    branch: string;
    batch: number;
    degree: string | null;
    gender: string | null;
    status: StudentStatus;
    rejectionReason: string | null;
    skills: string[];
    resumeFileId: string | null;
    cgpa: number | null;
    activeBacklogs: number | null;
    totalBacklogs: number | null;
    tenthPercent: number | null;
    twelfthPercent: number | null;
    diplomaPercent: number | null;
    verifiedAt: string | null;
    email: string;
    phone: string | null;
    /** Leave my name out of placement announcements (I'm still counted). */
    hideInAnnouncements: boolean;
  };
  draft: AcademicRecord | null;
  verified: AcademicRecord | null;
  documents: StudentDocument[];
  review: { status: string; type: string; submittedAt: string } | null;
  pendingUpdate: boolean;
  rejection: { reasonCode: string | null; note: string | null; at: string } | null;
  missing: string[];
  canEdit: boolean;
  canWithdraw: boolean;
}

export const studentApi = {
  get: () => api<StudentProfileView>("/students/me"),
  update: (body: Partial<{ name: string; phone: string | null; gender: string | null; degree: string | null; skills: string[]; resumeFileId: string | null; hideInAnnouncements: boolean }>) =>
    api<StudentProfileView>("/students/me", { method: "PATCH", body }),
  saveAcademics: (body: AcademicInput) => api<StudentProfileView>("/students/me/academics", { method: "PUT", body }),
  addDocument: (body: { fileId: string; type: StudentDocument["type"]; semester?: number | null }) =>
    api<StudentProfileView>("/students/me/documents", { method: "POST", body }),
  removeDocument: (id: string) => api<StudentProfileView>(`/students/me/documents/${id}`, { method: "DELETE" }),
  submit: () => api<StudentProfileView>("/students/me/submit", { method: "POST" }),
  withdraw: () => api<StudentProfileView>("/students/me/withdraw", { method: "POST" }),
  requestUpdate: (body: AcademicInput & { note?: string }) => api<StudentProfileView>("/students/me/update-requests", { method: "POST", body }),
};

export interface ReviewSummary {
  reviewer: "TPO" | "STAFF" | "VOLUNTEER";
  pledgeRequired: boolean;
  waiting: Record<string, number>;
  waitingTotal: number;
  doneToday: number;
  current: { id: string; type: string; claimedUntil: string } | null;
}

export interface QueueStudent {
  id: string;
  name: string;
  rollNo: string;
  branch: string;
  batch: number;
}

/** GET /work/queue: what is waiting, who is checking what, and this reviewer's recent decisions. */
export interface ReviewQueueOverview {
  reviewer: "TPO" | "STAFF" | "VOLUNTEER";
  rules: { types: string[]; risks: string[] | null; branches: string[] | null; batches: number[] | null; skipsOwnClass: boolean; secondChecked: boolean };
  stats: { waiting: number; oldestWaitingMinutes: number; doneToday: number; doneWeek: number; inProgress: number };
  waiting: {
    id: string;
    type: string;
    risk: "LOW" | "MEDIUM" | "HIGH";
    status: string;
    waitingMinutes: number;
    dueAt: string | null;
    student: QueueStudent | null;
    flags: { escalated: boolean; escalationNote: string | null; duplicateFile: boolean; lockExpired: boolean };
  }[];
  inProgress: { id: string; type: string; student: QueueStudent | null; reviewer: string | null; minutesLeft: number }[];
  recent: { id: string; type: string; decision: "APPROVE" | "REJECT" | null; reasonCode: string | null; decidedAt: string | null; outcome: "WITH_TPO" | "SECOND_CHECK" | "DONE"; student: QueueStudent | null }[];
}

export interface ReviewDoc {
  id: string;
  type: StudentDocument["type"];
  semester: number | null;
  status: string;
  flags: { duplicateOf?: string[] } | null;
  file: { id: string; originalName: string; mimeType: string; scanStatus: string; url: string | null };
}

export interface ReviewTaskView {
  id: string;
  type: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  status: string;
  createdAt: string;
  claimedUntil: string | null;
  escalationNote: string | null;
  student?: { id: string; name: string; rollNo: string; branch: string; batch: number; status: string };
  academics?: AcademicRecord | null;
  previousVerified?: AcademicRecord | null;
  documents?: ReviewDoc[];
  firstDecision?: { decision: string; reasonCode: string | null; note: string | null };
  subject?: ReviewTaskView;
}

/** GET /admin/overview: the placement office's numbers (counts only). */
export interface OfficeOverview {
  students: { total: number; incomplete: number; pending: number; verified: number; rejected: number; placed: number };
  drives: Record<string, number>;
  companies: number;
  review: { waiting: number; byType: Record<string, number>; escalated: number; oldestWaitingMinutes: number };
  offers: Record<string, number>;
  feedbackToCheck: number;
  pendingDrives: { id: string; roleTitle: string; company: string; waitingSince: string }[];
  upcomingRounds: { id: string; title: string; startsAt: string; where: string | null; driveId: string; roleTitle: string; company: string }[];
}

export const overviewApi = {
  get: () => api<OfficeOverview>("/admin/overview"),
};

/** GET /admin/students: one row in the placement office's student list. */
export interface OfficeStudentRow {
  id: string;
  name: string;
  rollNo: string;
  branch: string;
  batch: number;
  status: StudentStatus;
  placementStatus: "PLACED" | "NOT_PLACED";
  cgpa: number | null;
  activeBacklogs: number | null;
  tenthPercent: number | null;
  twelfthPercent: number | null;
  diplomaPercent: number | null;
  createdAt: string;
  email: string;
  drives: { invited: number; joined: number; selected: number };
}

export interface OfficeStudentList {
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number; PROFILE_INCOMPLETE: number; PENDING_VERIFICATION: number; VERIFIED: number; REJECTED: number; placed: number };
  branches: string[];
  batches: number[];
  students: OfficeStudentRow[];
}

/** GET /admin/students/:id: one student's whole record for the placement office. */
export interface OfficeStudentDetail {
  profile: Omit<OfficeStudentRow, "drives"> & {
    totalBacklogs: number | null;
    skills: string[];
    resumeFileId: string | null;
    verifiedAt: string | null;
    noShowCount: number;
    phone: string | null;
    joinedAt: string;
  };
  pendingUpdate: { cgpa: number | null; semester: number | null; createdAt: string } | null;
  documents: { id: string; type: StudentDocument["type"]; semester: number | null; status: string; file: { id: string; originalName: string; scanStatus: string; sizeBytes: number } }[];
  drives: {
    id: string;
    driveId: string;
    roleTitle: string;
    company: string;
    driveStatus: DriveStatus;
    jobType: JobType;
    ctcLpa: number | null;
    stipendMonthly: number | null;
    status: ParticipationStatus;
    invitedAt: string;
    respondedAt: string | null;
    offer: { status: string; ctcLpa: number | null; respondBy: string } | null;
  }[];
}

export const officeStudentsApi = {
  list: (query: string) => api<OfficeStudentList>(`/admin/students${query ? `?${query}` : ""}`),
  get: (id: string) => api<OfficeStudentDetail>(`/admin/students/${id}`),
};

/** A clash between this drive and another live drive (GET /drives/:id/clashes, TPO only). */
export interface DriveClash {
  severity: "high" | "medium";
  kind: "venue" | "students" | "busy_day" | "deadline";
  round: { id: string | null; title: string; start: string | null; end: string | null; venue: string | null } | null;
  other: { driveId: string; company: string; roleTitle: string; roundTitle: string | null; start: string | null; end: string | null; venue: string | null } | null;
  shared?: number;
  count?: number;
  day: string;
}

/** A busy-time hint for HR picking a round time (no other company's details). */
export interface SlotNote {
  severity: "high" | "medium";
  kind: DriveClash["kind"];
  roundTitle: string | null;
  message: string;
}

export interface CalendarEvent {
  id: string;
  kind: "round";
  title: string;
  roundType: RoundType;
  mode: "OFFLINE" | "ONLINE";
  start: string;
  end: string;
  day: string;
  venue: string | null;
  roundStatus: NonNullable<Round["status"]>;
  driveId: string;
  roleTitle: string;
  company: string;
  driveStatus: DriveStatus;
  joined: number;
  clash: "venue" | null;
}

export interface CalendarDeadline {
  driveId: string;
  roleTitle: string;
  company: string;
  driveStatus: DriveStatus;
  at: string;
  day: string;
}

export const scheduleApi = {
  clashes: (driveId: string) => api<{ clashes: DriveClash[]; checkedAt: string }>(`/drives/${driveId}/clashes`),
  slotCheck: (driveId: string, body: { title?: string; mode: "OFFLINE" | "ONLINE"; startsAt: string; endsAt?: string | null; venue?: string | null }) =>
    api<{ notes: SlotNote[] }>(`/drives/${driveId}/slot-check`, { method: "POST", body }),
  calendar: (from: string, to: string) => api<{ events: CalendarEvent[]; deadlines: CalendarDeadline[] }>(`/admin/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
};

export const workApi = {
  summary: () => api<ReviewSummary>("/work/summary"),
  queue: () => api<ReviewQueueOverview>("/work/queue"),
  pledge: () => api<{ pledgeAcceptedAt: string }>("/work/onboarding/pledge", { method: "POST" }),
  next: async () => {
    const r = await api<ReviewTaskView | { task: null }>("/work/next", { method: "POST" });
    return "task" in r && r.task === null ? null : (r as ReviewTaskView);
  },
  get: (id: string) => api<ReviewTaskView>(`/work/tasks/${id}`),
  claim: (id: string) => api<ReviewTaskView>(`/work/tasks/${id}/claim`, { method: "POST" }),
  decide: (id: string, body: { decision: "APPROVE" | "REJECT"; reasonCode?: string | null; note?: string | null }) =>
    api<{ outcome: "closed" | "sent_for_second_check" | "escalated" }>(`/work/tasks/${id}/decision`, { method: "POST", body }),
  release: (id: string) => api<{ released: boolean }>(`/work/tasks/${id}/release`, { method: "POST" }),
  extend: (id: string) => api<{ claimedUntil: string }>(`/work/tasks/${id}/extend`, { method: "POST" }),
  escalate: (id: string, note: string) => api<{ escalated: boolean }>(`/work/tasks/${id}/escalate`, { method: "POST", body: { note } }),
};

export interface TeamMember {
  userId: string;
  email: string;
  name: string | null;
  role: "STAFF" | "VOLUNTEER";
  capabilities: string[];
  scope: { branches?: string[]; batches?: number[] } | null;
  status: string;
  pledgeAccepted: boolean;
  tasksDecided: number;
}
export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  capabilities: string[];
  scope: { branches?: string[]; batches?: number[] } | null;
  expiresAt: string;
}

export const teamApi = {
  list: () => api<{ members: TeamMember[]; invites: TeamInvite[] }>("/admin/team"),
  invite: (body: { email: string; role: "STAFF" | "VOLUNTEER"; capabilities: string[]; scope?: { branches?: string[]; batches?: number[] } }) =>
    api<{ inviteId: string }>("/admin/team", { method: "POST", body }),
  remove: (userId: string, role: "STAFF" | "VOLUNTEER") => api<void>(`/admin/team/${userId}/${role}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Drives (BACKEND-DESIGN.md §9.6)
// ---------------------------------------------------------------------------

export interface Round {
  id?: string;
  sequence?: number;
  type: RoundType;
  title: string;
  mode: "OFFLINE" | "ONLINE";
  startsAt: string | null;
  endsAt?: string | null;
  venue: string | null;
  onlineLink: string | null;
  instructions: string | null;
  status?: "SCHEDULED" | "IN_PROGRESS" | "RESULTS_PENDING" | "RESULTS_PUBLISHED" | "CANCELLED";
  /** Student view only: my part in this round. */
  my?: {
    attended: boolean;
    result: ResultValue | null;
    out: "ABSENT" | "NOT_SELECTED" | null;
    checkInOpen: boolean;
    line: MyLine | null;
    feedback: string[];
  } | null;
}

export interface DriveBasics {
  roleTitle: string;
  description: string;
  jobType: JobType;
  ctcLpa: number | null;
  stipendMonthly: number | null;
  location: string | null;
  bondMonths: number | null;
  optInDeadline: string | null;
  eligibility: Eligibility;
}

export interface OfficeDrive extends DriveBasics {
  id: string;
  company: { id: string; name: string; status: string };
  status: DriveStatus;
  rejectionReason: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rounds: Round[];
  missing: string[];
  counts: { invited: number; joined: number; skipped: number; total: number };
  can: { edit: boolean; editLimited: boolean; editRounds: boolean; submit: boolean; withdraw: boolean; decide: boolean; invite: boolean; cancel: boolean; delete: boolean; announce: boolean; unannounce: boolean };
  /** When the TPO announced who was selected (null: not announced). */
  announcedAt: string | null;
  /** Students selected in the final round (selected, offered or placed). */
  selectedCount: number;
}

export interface DriveListItem {
  id: string;
  company: { id: string; name: string };
  roleTitle: string;
  jobType: JobType;
  ctcLpa: number | null;
  stipendMonthly: number | null;
  status: DriveStatus;
  optInDeadline: string | null;
  rounds: number;
  roundsDone: number;
  currentRound: string | null;
  nextRound: { title: string | null; startsAt: string | null };
  /** Ever invited (not taken back) */
  invited: number;
  /** Invited, not answered yet */
  awaiting: number;
  /** Joined (still in, or already selected) */
  joined: number;
  /** Joined and still in the rounds */
  active: number;
  selected: number;
  placed: number;
  updatedAt: string;
}

export interface EligibleStudent {
  id: string;
  name: string;
  rollNo: string;
  branch: string;
  batch: number;
  cgpa: number | null;
  activeBacklogs: number | null;
  inDrive: ParticipationStatus | null;
}

export interface Participant extends Omit<EligibleStudent, "inDrive"> {
  status: ParticipationStatus;
  invitedAt: string;
  respondedAt: string | null;
}

export interface MyState {
  status: ParticipationStatus;
  canJoin: boolean;
  canSkip: boolean;
}

export interface MyDriveCard {
  id: string;
  company: string;
  roleTitle: string;
  jobType: JobType;
  ctcLpa: number | null;
  stipendMonthly: number | null;
  location: string | null;
  status: DriveStatus;
  optInDeadline: string | null;
  rounds: number;
  nextRound: { title: string; startsAt: string | null } | null;
  me: MyState;
}

export interface OtherDrive {
  id: string;
  company: string;
  roleTitle: string;
  jobType: JobType;
  status: DriveStatus;
}

export type StudentDriveView =
  | (OtherDrive & { inDrive: false })
  | (Omit<DriveBasics, "eligibility"> & {
      id: string;
      inDrive: true;
      company: string;
      companyWebsite: string | null;
      companyAbout: string | null;
      status: DriveStatus;
      cancelReason: string | null;
      eligibility: Eligibility;
      rounds: Round[];
      me: MyState & { invitedAt: string; respondedAt: string | null };
      offer: OfferView | null;
      /** Who was selected: the count once final results are out, names once the TPO announces (null for students who didn't take part). */
      selected: SelectedList | null;
    });

export interface SelectedList {
  count: number;
  announcedAt: string | null;
  names: { name: string; branch: string }[];
  /** Selected students who chose not to be named. */
  hidden: number;
}

/** One announced drive, for the home page's placement news. */
export interface PlacementNews {
  id: string;
  company: string;
  roleTitle: string;
  jobType: JobType;
  ctcLpa: number | null;
  stipendMonthly: number | null;
  status: DriveStatus;
  announcedAt: string;
  count: number;
  names: { name: string; branch: string }[];
  hidden: number;
}

export const drivesApi = {
  list: () => api<{ companies: { id: string; name: string }[] | null; drives: DriveListItem[] }>("/drives"),
  get: (id: string) => api<OfficeDrive>(`/drives/${id}`),
  create: (body: Partial<DriveBasics> & { roleTitle: string; companyId?: string }) => api<OfficeDrive>("/drives", { method: "POST", body }),
  update: (id: string, body: Partial<DriveBasics>) => api<OfficeDrive>(`/drives/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/drives/${id}`, { method: "DELETE" }),
  saveRounds: (id: string, rounds: Round[]) =>
    api<OfficeDrive>(`/drives/${id}/rounds`, { method: "PUT", body: { rounds: rounds.map(withoutServerFields) } }),
  submit: (id: string) => api<OfficeDrive>(`/drives/${id}/submit`, { method: "POST" }),
  withdraw: (id: string) => api<OfficeDrive>(`/drives/${id}/withdraw`, { method: "POST" }),
  approve: (id: string) => api<OfficeDrive>(`/admin/drives/${id}/approve`, { method: "POST" }),
  reject: (id: string, reason: string) => api<OfficeDrive>(`/admin/drives/${id}/reject`, { method: "POST", body: { reason } }),
  cancel: (id: string, reason: string) => api<OfficeDrive>(`/admin/drives/${id}/cancel`, { method: "POST", body: { reason } }),
  announce: (id: string) => api<OfficeDrive>(`/admin/drives/${id}/announce`, { method: "POST" }),
  unannounce: (id: string, reason: string) => api<OfficeDrive>(`/admin/drives/${id}/unannounce`, { method: "POST", body: { reason } }),
  announcements: () => api<{ announcements: PlacementNews[] }>("/announcements"),
  preview: (id: string, eligibility?: Eligibility) =>
    api<{ count: number; students: EligibleStudent[] }>(`/drives/${id}/eligibility/preview`, { method: "POST", body: eligibility ? { eligibility } : {} }),
  invite: (id: string, body: { all?: boolean; studentIds?: string[] }) => api<{ invited: number; alreadyIn: number }>(`/drives/${id}/invitations`, { method: "POST", body }),
  participants: (id: string) => api<{ participants: Participant[] }>(`/drives/${id}/participants`),
  uninvite: (id: string, studentId: string) => api<void>(`/drives/${id}/invitations/${studentId}`, { method: "DELETE" }),
  companies: () => api<{ companies: { id: string; name: string; status: string }[] }>("/admin/companies"),
  addCompany: (body: { name: string; website?: string | null; industry?: string | null }) => api<{ id: string; name: string }>("/admin/companies", { method: "POST", body }),
  mine: () => api<{ mine: MyDriveCard[]; others: OtherDrive[] }>("/me/drives"),
  mineOne: (id: string) => api<StudentDriveView>(`/me/drives/${id}`),
  join: (id: string) => api<StudentDriveView>(`/me/drives/${id}/opt-in`, { method: "POST", body: { consent: true } }),
  skip: (id: string) => api<StudentDriveView>(`/me/drives/${id}/opt-out`, { method: "POST" }),
};

/** The rounds API takes what the builder edits, not the server-owned order and status. */
function withoutServerFields(r: Round): Round {
  const copy = { ...r };
  delete copy.sequence;
  delete copy.status;
  return copy;
}

// ---------------------------------------------------------------------------
// Running rounds: attendance and results (BACKEND-DESIGN.md §9.8, §9.9)
// ---------------------------------------------------------------------------

export interface RoundStudent {
  id: string;
  participationId: string;
  name: string;
  rollNo: string;
  branch: string;
  batch: number;
  cgpa: number | null;
  status: ParticipationStatus;
  present: boolean;
  attendance: { method: "QR" | "MANUAL"; createdAt: string; reason: string | null } | null;
  result: ResultValue;
  source: "MANUAL" | "IMPORT" | null;
}

export interface RoundView {
  id: string;
  sequence: number;
  type: RoundType;
  title: string;
  mode: "OFFLINE" | "ONLINE";
  startsAt: string | null;
  venue: string | null;
  venueLat: number | null;
  venueLng: number | null;
  venueRadiusM: number | null;
  status: NonNullable<Round["status"]>;
  hasResults: boolean;
  isLast: boolean;
  drive: { id: string; roleTitle: string; company: { id: string; name: string }; status: DriveStatus };
  session: { id: string; openedAt: string; venueLat: number | null; venueLng: number | null; radiusM: number | null } | null;
  tookAttendance: boolean;
  students: RoundStudent[];
  counts: { total: number; present: number; pending: number; onHold: number; selected: number };
  can: { start: boolean; startBlockedBy: string | null; attendance: boolean; manual: boolean; results: boolean; publish: boolean };
}

export interface CheckInResult {
  checkedIn: true;
  alreadyCheckedIn: boolean;
  round: string;
  company: string;
  roleTitle: string;
  driveId: string;
}

export const roundsApi = {
  get: (id: string) => api<RoundView>(`/rounds/${id}`),
  start: (id: string) => api<RoundView>(`/rounds/${id}/start`, { method: "POST" }),
  setResults: (id: string, results: { participationId: string; result: ResultValue }[]) => api<RoundView>(`/rounds/${id}/results`, { method: "PUT", body: { results } }),
  importCsv: (id: string, csv: string) =>
    api<{ round: RoundView; imported: number; unknownRolls: string[]; badValues: { row: number; value: string }[] }>(`/rounds/${id}/results/import`, { method: "POST", body: { csv } }),
  publish: (id: string) => api<RoundView>(`/rounds/${id}/results/publish`, { method: "POST" }),
  openCheckIn: (id: string, body: { lat?: number | null; lng?: number | null; radiusM?: number | null }) =>
    api<{ id: string }>(`/rounds/${id}/attendance/sessions`, { method: "POST", body }),
  qr: (sid: string) => api<{ token: string; url: string; expiresInMs: number; present: number }>(`/attendance/sessions/${sid}/qr`),
  closeCheckIn: (sid: string) => api<RoundView>(`/attendance/sessions/${sid}/close`, { method: "POST" }),
  manual: (id: string, body: { participationId: string; present: boolean; reason: string }) => api<RoundView>(`/rounds/${id}/attendance/manual`, { method: "POST", body }),
  checkIn: (body: { token: string; lat?: number | null; lng?: number | null }) => api<CheckInResult>("/attendance/check-in", { method: "POST", body }),
};

// ---------------------------------------------------------------------------
// Interview panels and the live line (BACKEND-DESIGN.md §9.10)
// ---------------------------------------------------------------------------

export type QueueStatus = "WAITING" | "CALLED" | "IN_INTERVIEW" | "DONE" | "SKIPPED" | "ABSENT";
export type Recommendation = "SELECT" | "REJECT" | "HOLD";

export interface MyLine {
  roundId: string;
  panel: string;
  location: string | null;
  status: QueueStatus;
  position: number | null;
  waitMinutes: number | null;
}

export interface PanelPerson {
  id: string;
  name: string | null;
  email: string;
  role: "HR" | "INTERVIEWER";
}

export interface PanelSummary {
  id: string;
  name: string;
  location: string | null;
  members: { id: string; name: string | null; email: string }[];
  counts: { waiting: number; live: number; done: number; absent: number; total: number };
  avgMinutes: number;
}

export interface QueueRow {
  id: string;
  status: QueueStatus;
  position: number;
  skipCount: number;
  calledAt: string | null;
  student: {
    id: string;
    name: string;
    rollNo: string;
    branch: string;
    batch: number;
    cgpa: number | null;
    activeBacklogs: number | null;
    skills: string[];
    links: { label: string; url: string }[] | null;
    resumeFileId: string | null;
  };
  session: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    privateNotes: string | null;
    recommendation: Recommendation | null;
    ratings: Record<string, number> | null;
    strengths: string[];
    concerns: string[];
  } | null;
  /** The student's earlier rounds in this drive: result, attendance, every panel's notes and key points. */
  history: EarlierRound[];
  feedback: { text: string; status: string } | null;
}

export interface PanelView {
  id: string;
  name: string;
  location: string | null;
  round: { id: string; title: string; type: RoundType; status: string; driveId: string; roleTitle: string; company: string };
  /** What this round's panels rate, 1–5 */
  criteria: Criterion[];
  running: boolean;
  avgMinutes: number;
  current: QueueRow | null;
  waiting: QueueRow[];
  done: QueueRow[];
}

export interface FeedbackItem {
  id: string;
  student: { name: string; rollNo: string };
  round: string | null;
  author: string | null;
  text: string;
  releasedText: string | null;
  status: "PENDING_REVIEW" | "RELEASED" | "EDITED_AND_RELEASED" | "WITHHELD";
  createdAt: string;
}

export const interviewsApi = {
  panels: (roundId: string) => api<{ panels: PanelSummary[] }>(`/rounds/${roundId}/panels`),
  people: (roundId: string) => api<{ people: PanelPerson[] }>(`/rounds/${roundId}/panel-people`),
  addPanel: (roundId: string, body: { name: string; location?: string | null; memberIds: string[] }) => api<{ panels: PanelSummary[] }>(`/rounds/${roundId}/panels`, { method: "POST", body }),
  removePanel: (panelId: string) => api<{ panels: PanelSummary[] }>(`/panels/${panelId}`, { method: "DELETE" }),
  buildLine: (roundId: string) => api<{ added: number; panels: PanelSummary[] }>(`/rounds/${roundId}/queue`, { method: "POST" }),
  recommendations: (roundId: string) => api<{ interviews: PanelOpinion[] }>(`/rounds/${roundId}/interviews`),
  myPanels: () =>
    api<{ panels: { id: string; name: string; location: string | null; round: { title: string; status: string; startsAt: string | null; roleTitle: string; company: string }; waiting: number; done: number }[] }>("/me/panels"),
  panel: (panelId: string) => api<PanelView>(`/panels/${panelId}`),
  callNext: (panelId: string) => api<PanelView>(`/panels/${panelId}/call-next`, { method: "POST" }),
  start: (entryId: string) => api<PanelView>(`/queue/${entryId}/start`, { method: "POST" }),
  end: (
    entryId: string,
    body: {
      privateNotes?: string | null;
      recommendation?: Recommendation | null;
      feedback?: string | null;
      ratings?: Record<string, number> | null;
      strengths?: string[];
      concerns?: string[];
    },
  ) => api<PanelView>(`/queue/${entryId}/end`, { method: "POST", body }),
  skip: (entryId: string) => api<PanelView>(`/queue/${entryId}/skip`, { method: "POST" }),
  requeue: (entryId: string) => api<PanelView>(`/queue/${entryId}/requeue`, { method: "POST" }),
  move: (entryId: string, panelId: string) => api<PanelView>(`/queue/${entryId}/move`, { method: "POST", body: { panelId } }),
  feedback: (driveId: string) => api<{ feedback: FeedbackItem[] }>(`/drives/${driveId}/feedback`),
  reviewFeedback: (id: string, body: { action: "RELEASE" | "WITHHOLD"; text?: string | null }) => api<{ feedback: FeedbackItem[] }>(`/admin/feedback/${id}`, { method: "POST", body }),
  companyTeam: () =>
    api<{ company: string; members: PanelPerson[]; invites: { id: string; email: string; role: string; expiresAt: string }[] }>("/company/team"),
  inviteInterviewer: (email: string) => api<{ inviteId: string }>("/company/team", { method: "POST", body: { email } }),
};

// ---------------------------------------------------------------------------
// Offers (BACKEND-DESIGN.md §9.11)
// ---------------------------------------------------------------------------

export interface OfferView {
  id: string;
  status: "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "REVOKED";
  roleTitle: string;
  ctcLpa: number | null;
  joiningDate: string | null;
  respondBy: string;
  respondedAt: string | null;
  revokeReason: string | null;
  sentAt: string;
  updatedAt: string;
}

export interface OffersList {
  drive: { id: string; roleTitle: string; ctcLpa: number | null; status: DriveStatus };
  responseDays: number;
  canSend: boolean;
  selected: { participationId: string; status: ParticipationStatus; student: { name: string; rollNo: string; branch: string; batch: number }; offer: (OfferView & { fileName: string }) | null }[];
}

export const offersApi = {
  list: (driveId: string) => api<OffersList>(`/drives/${driveId}/offers`),
  send: (driveId: string, body: { participationId: string; fileId: string; ctcLpa?: number | null; joiningDate?: string | null; respondBy?: string | null }) =>
    api<OffersList>(`/drives/${driveId}/offers`, { method: "POST", body }),
  revoke: (offerId: string, reason: string) => api<OffersList>(`/offers/${offerId}/revoke`, { method: "POST", body: { reason } }),
  letter: (offerId: string) => api<{ url: string; expiresInSeconds: number }>(`/offers/${offerId}/letter`),
  accept: (offerId: string) => api<{ status: string }>(`/me/offers/${offerId}/accept`, { method: "POST" }),
  decline: (offerId: string) => api<{ status: string }>(`/me/offers/${offerId}/decline`, { method: "POST" }),
  closeDrive: (driveId: string) => api<{ status: string }>(`/admin/drives/${driveId}/close`, { method: "POST" }),
};

export interface KeyPoints {
  recommendation: Recommendation | null;
  ratings: Record<string, number> | null;
  average: number | null;
  strengths: string[];
  concerns: string[];
  privateNotes: string | null;
}

/** One panel's view of one student in a round (HR's results table). */
export interface PanelOpinion extends KeyPoints {
  participationId: string;
  panel: string;
  status: QueueStatus;
}

export interface EarlierRound {
  roundId: string;
  title: string;
  type: RoundType;
  result: ResultValue | null;
  attended: boolean;
  interviews: (KeyPoints & { panel: string; status: QueueStatus; interviewer: string | null })[];
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  channel: "QUEUE" | "DRIVES" | "OFFERS" | "GENERAL";
  title: string;
  body: string;
  link: string | null;
  /** In-app path to open (null when the notice has no page) */
  path: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: (before?: string) => api<{ unread: number; items: NotificationItem[]; more: boolean }>(`/me/notifications${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  unreadCount: () => api<{ unread: number }>("/me/notifications/unread-count"),
  read: (ids?: string[]) => api<{ unread: number }>("/me/notifications/read", { method: "POST", body: ids ? { ids } : {} }),
};
