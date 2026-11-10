/**
 * The sanitizer container's only program. It holds no secrets and talks to nothing: the worker
 * sends it a file, it answers with the clean copy.
 *
 *   POST /sanitize   (body: the file, content-type: its type)
 *     200 → the clean file; header x-cyrus-notes: base64 JSON list of what was removed
 *     422 → { code, message }: the file is refused (password-protected, damaged, too big…)
 *     500 → the sanitizer itself failed
 *   GET /health
 *
 * Every file is cleaned in its own throw-away process (run.ts). On top of that the whole container
 * recycles itself: it exits once it has been up for RECYCLE_AFTER_MS and is idle, and Docker
 * (restart: always, read-only filesystem) starts a pristine one. Under a burst it keeps serving
 * instead of restarting between files, because Docker slows down containers that exit too quickly.
 * Self-contained on purpose (see sanitize.ts).
 */
import { createServer } from "node:http";
import { sanitizeInFreshProcess, SanitizerFailed } from "./run.ts";
import { SanitizeRejected } from "./sanitize.ts";

const PORT = Number(process.env["SANITIZER_PORT"] ?? 4010);
const MAX_BODY_BYTES = Number(process.env["SANITIZER_MAX_MB"] ?? 60) * 1024 * 1024;
const RECYCLE_AFTER_MS = Number(process.env["SANITIZER_RECYCLE_AFTER_MS"] ?? 15_000);
const started = Date.now();
let busy = 0;
let served = 0;

const server = createServer((req, res) => {
  const json = (status: number, body: object) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return json(200, { status: "ok", served, upMs: Date.now() - started });
  if (req.method !== "POST" || req.url !== "/sanitize") return json(404, { code: "NOT_FOUND", message: "Unknown route." });

  busy += 1;
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY_BYTES) tooBig = true;
    else chunks.push(c);
  });
  req.on("end", () => {
    const finish = () => {
      busy -= 1;
      served += 1;
      recycleIfDue();
    };
    if (tooBig) {
      json(413, { code: "TOO_LARGE", message: "The file is too large." });
      return finish();
    }
    sanitizeInFreshProcess(Buffer.concat(chunks), String(req.headers["content-type"] ?? ""))
      .then((out) => {
        res.writeHead(200, { "content-type": out.mimeType, "content-length": out.bytes.length, "x-cyrus-notes": Buffer.from(JSON.stringify(out.notes)).toString("base64") });
        res.end(out.bytes);
      })
      .catch((e: unknown) => {
        if (e instanceof SanitizeRejected) return json(422, { code: e.code, message: e.message });
        console.error("sanitizer failed:", e instanceof SanitizerFailed ? e.message : e);
        json(500, { code: "SANITIZER_FAILED", message: "The file could not be processed." });
      })
      .finally(finish);
  });
});

function recycleIfDue() {
  if (RECYCLE_AFTER_MS <= 0 || busy > 0 || served === 0 || Date.now() - started < RECYCLE_AFTER_MS) return;
  console.log(`recycling after ${served} file(s)`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
// Also recycle when the burst ends, not only on the next file.
setInterval(recycleIfDue, 5000).unref();

server.listen(PORT, "0.0.0.0", () => console.log(`sanitizer listening on ${PORT}`));
