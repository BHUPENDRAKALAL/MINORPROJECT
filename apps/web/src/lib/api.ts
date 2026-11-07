/** Base URL of the API. Empty in the browser dev server (Vite forwards /api); set VITE_API_URL for Tauri builds. */
const BASE = import.meta.env.VITE_API_URL ?? "";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;
  constructor(status: number, body: ApiErrorBody | undefined) {
    super(body?.error.message ?? `Request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Small fetch wrapper for /api/v1. Returns the JSON body even for non-2xx responses when `allowStatus` includes it. */
export async function apiGet<T>(path: string, allowStatus: number[] = []): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, { credentials: "include" });
  const body = (await res.json().catch(() => undefined)) as T | ApiErrorBody | undefined;
  if (!res.ok && !allowStatus.includes(res.status)) throw new ApiRequestError(res.status, body as ApiErrorBody | undefined);
  return body as T;
}
