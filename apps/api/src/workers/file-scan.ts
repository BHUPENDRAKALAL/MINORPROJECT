import type { Db } from "../lib/db.ts";
import type { Storage } from "../lib/storage.ts";
import type { Sanitizer } from "../lib/sanitizer.ts";
import { SanitizeRejected } from "../sanitizer/sanitize.ts";

/**
 * Makes an uploaded file safe before anyone but its owner may open it (documents queue).
 *
 * We don't try to detect what is bad in a file. The file is rebuilt: PDFs keep only their pages
 * (scripts, auto-run actions and attached files are never copied), images are encoded again.
 * The clean copy REPLACES the upload in storage; the original is not kept.
 * The work happens in a throw-away process or the sanitizer container (see lib/sanitizer.ts).
 *
 *  - CLEAN:    the stored file is now the clean copy
 *  - INFECTED: the file was refused (password-protected, damaged, too big…); scanNote says why,
 *              and the stored upload is deleted
 *  - FAILED:   the sanitizer itself broke; the job is retried
 *
 * `sha256` stays the hash of the ORIGINAL upload, so the same marksheet uploaded by two students
 * is still noticed.
 */
export async function scanFile(db: Db, storage: Storage, sanitize: Sanitizer, fileId: string) {
  const file = await db.fileObject.findUnique({ where: { id: fileId } });
  // FAILED files are tried again when the job is retried.
  if (!file || (file.scanStatus !== "PENDING" && file.scanStatus !== "FAILED")) return { skipped: true };
  let clean;
  try {
    clean = await sanitize(await storage.get(file.storageKey), file.mimeType);
  } catch (e) {
    if (e instanceof SanitizeRejected) {
      await db.fileObject.update({ where: { id: fileId }, data: { scanStatus: "INFECTED", scanNote: e.message } });
      await storage.remove(file.storageKey).catch(() => undefined);
      return { scanStatus: "INFECTED", code: e.code };
    }
    await db.fileObject.update({ where: { id: fileId }, data: { scanStatus: "FAILED" } });
    throw e;
  }
  await storage.put(file.storageKey, clean.bytes, clean.mimeType);
  await db.fileObject.update({
    where: { id: fileId },
    data: { scanStatus: "CLEAN", sizeBytes: clean.bytes.length, scanNote: clean.notes.length ? clean.notes.join("; ").slice(0, 500) : null },
  });
  return { scanStatus: "CLEAN", notes: clean.notes, engine: "rebuild" };
}
