/**
 * Runs once per file, in its own process, and exits. The parent starts it with no secrets in its
 * environment, a memory cap and a time limit, and kills it if it misbehaves.
 *
 *   node sanitize-child.ts <mime type>   (file on stdin)
 *
 * Output on stdout: 4 bytes (length of the header), a JSON header, then the clean file.
 * Header: { ok: true, mimeType, notes } or { ok: false, code, message } when the file is refused.
 * Self-contained on purpose (see sanitize.ts).
 */
import { sanitize, SanitizeRejected } from "./sanitize.ts";

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function reply(header: object, body: Buffer = Buffer.alloc(0)): Promise<void> {
  const head = Buffer.from(JSON.stringify(header));
  const size = Buffer.alloc(4);
  size.writeUInt32BE(head.length);
  return new Promise((resolve) => process.stdout.write(Buffer.concat([size, head, body]), () => resolve()));
}

try {
  const input = await readStdin();
  const out = await sanitize(input, process.argv[2] ?? "");
  await reply({ ok: true, mimeType: out.mimeType, notes: out.notes }, out.bytes);
  process.exit(0);
} catch (e) {
  if (e instanceof SanitizeRejected) {
    await reply({ ok: false, code: e.code, message: e.message });
    process.exit(0);
  }
  process.stderr.write(String((e as Error)?.stack ?? e));
  process.exit(1);
}
