/**
 * Cleans one file in a fresh process that is thrown away afterwards (sanitize-child.ts).
 * Whatever a hostile file manages to do in there, it has no secrets to read, a memory cap,
 * a time limit, and it is gone before the next file. Self-contained on purpose (see sanitize.ts).
 */
import { spawn } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { SanitizeRejected, type RejectCode, type Sanitized } from "./sanitize.ts";

export const SANITIZE_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 80 * 1024 * 1024;
const CHILD_HEAP_MB = 256;

// Same folder and same extension as this file: .ts when run from source, .js from the built bundle.
const CHILD = fileURLToPath(new URL(`./sanitize-child${extname(fileURLToPath(import.meta.url)) || ".js"}`, import.meta.url));

/** Only what a process needs to start. No database URL, no app secret, no storage keys. */
function bareEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE"];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

export class SanitizerFailed extends Error {}

export function sanitizeInFreshProcess(input: Uint8Array, mimeType: string, timeoutMs = SANITIZE_TIMEOUT_MS): Promise<Sanitized> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`--max-old-space-size=${CHILD_HEAP_MB}`, CHILD, mimeType], { env: bareEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new SanitizerFailed(`Took longer than ${timeoutMs} ms and was stopped.`))), timeoutMs);

    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_OUTPUT_BYTES) return finish(() => reject(new SanitizerFailed("Produced too much output and was stopped.")));
      out.push(c);
    });
    child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-2000)));
    child.on("error", (e) => finish(() => reject(new SanitizerFailed(`Could not start: ${e.message}`))));
    child.on("close", (code) =>
      finish(() => {
        const all = Buffer.concat(out);
        if (code !== 0 || all.length < 4) return reject(new SanitizerFailed(`Stopped with code ${code}. ${stderr}`.trim()));
        try {
          const headLength = all.readUInt32BE(0);
          const head = JSON.parse(all.subarray(4, 4 + headLength).toString()) as { ok: boolean; mimeType?: string; notes?: string[]; code?: RejectCode; message?: string };
          if (!head.ok) return reject(new SanitizeRejected(head.code ?? "TYPE_NOT_SUPPORTED", head.message ?? "This file can't be accepted."));
          resolve({ bytes: all.subarray(4 + headLength), mimeType: head.mimeType ?? mimeType, notes: head.notes ?? [] });
        } catch {
          reject(new SanitizerFailed("Gave an answer that could not be read."));
        }
      }),
    );
    child.stdin.on("error", () => undefined); // the child may exit before reading everything
    child.stdin.end(input);
  });
}
