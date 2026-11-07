import type { Role } from "@cyrus/shared";
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
  /** Send the access token and refresh on 401. Defaults to true. Public auth routes pass false. */
  auth?: boolean;
  /** Return the parsed body for these non-2xx statuses instead of throwing (used by /ready). */
  allowStatus?: number[];
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false && session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
  try {
    return await fetch(`${BASE}${PREFIX}${path}`, {
      method: opts.method ?? "GET",
      credentials: "include",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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
  changePassword: (currentPassword: string, newPassword: string) =>
    api<void>("/me/password", { method: "PATCH", body: { currentPassword, newPassword } }),
};
