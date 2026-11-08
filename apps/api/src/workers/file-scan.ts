import type { Db } from "../lib/db.ts";
import type { Storage } from "../lib/storage.ts";

/**
 * Checks an uploaded file before anyone else may open it (documents queue).
 *
 * For now this is a basic check: PDFs that carry scripts or auto-launch actions are blocked,
 * because those are the usual way a "marksheet" PDF carries something harmful.
 * A full antivirus engine (ClamAV) can be plugged in here later without changing callers.
 */
// /OpenAction is left out on purpose: many normal PDFs use it just to set the opening page or zoom.
const RISKY_PDF_MARKERS = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile"];

export async function scanFile(db: Db, storage: Storage, fileId: string) {
  const file = await db.fileObject.findUnique({ where: { id: fileId } });
  if (!file || file.scanStatus !== "PENDING") return { skipped: true };
  try {
    const body = await storage.get(file.storageKey);
    let found: string[] = [];
    if (file.mimeType === "application/pdf") {
      const text = body.toString("latin1");
      found = RISKY_PDF_MARKERS.filter((m) => new RegExp(`${m.replace("/", "\\/")}\\b`).test(text));
    }
    const scanStatus = found.length ? "INFECTED" : "CLEAN";
    await db.fileObject.update({ where: { id: fileId }, data: { scanStatus } });
    return { scanStatus, found, engine: "basic-pdf-check" };
  } catch (e) {
    await db.fileObject.update({ where: { id: fileId }, data: { scanStatus: "FAILED" } });
    throw e;
  }
}
