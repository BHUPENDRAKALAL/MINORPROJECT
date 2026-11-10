import { sanitizeInFreshProcess, SanitizerFailed } from "../sanitizer/run.ts";
import { SanitizeRejected, type RejectCode, type Sanitized } from "../sanitizer/sanitize.ts";

export type Sanitizer = (bytes: Buffer, mimeType: string) => Promise<Sanitized>;

const TRIES = 6;
const WAIT_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How the worker gets a file cleaned.
 *  - With SANITIZER_URL: by the sanitizer container (no secrets, read-only, recycles itself).
 *    While it is recycling (about a second) the call is tried again.
 *  - Without it, or if the container can't be reached: in a throw-away process on this machine.
 *    Still a fresh process per file with no secrets, only without the container's walls.
 * Throws SanitizeRejected when the file itself is refused.
 */
export function createSanitizer(opts: { url?: string; log?: { warn: (details: object, message: string) => void } }): Sanitizer {
  const url = opts.url?.replace(/\/$/, "");
  if (!url) return (bytes, mimeType) => sanitizeInFreshProcess(bytes, mimeType);

  return async (bytes, mimeType) => {
    let lastError: unknown;
    for (let i = 0; i < TRIES; i++) {
      let res: Response;
      try {
        res = await fetch(`${url}/sanitize`, { method: "POST", headers: { "content-type": mimeType }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (e) {
        // Not reachable (recycling, or not running): wait a moment and try again.
        lastError = e;
        await new Promise((r) => setTimeout(r, WAIT_MS));
        continue;
      }
      if (res.status === 200) {
        const notes = JSON.parse(Buffer.from(res.headers.get("x-cyrus-notes") ?? "W10=", "base64").toString()) as string[];
        return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? mimeType, notes };
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (res.status === 422) throw new SanitizeRejected((body.code ?? "TYPE_NOT_SUPPORTED") as RejectCode, body.message ?? "This file can't be accepted.");
      throw new SanitizerFailed(`Sanitizer answered ${res.status}: ${body.message ?? ""}`);
    }
    opts.log?.warn({ err: String(lastError) }, "Sanitizer container not reachable; cleaning the file in a local throw-away process instead");
    return sanitizeInFreshProcess(bytes, mimeType);
  };
}
