import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { memoryStorage } from "../lib/storage.ts";
import { createSanitizer } from "../lib/sanitizer.ts";
import { hasTestDb, resetDb, testDb } from "../../test/helpers.ts";
import { scanFile } from "./file-scan.ts";

async function pdfWithScript() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.register(doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert(1)") })));
  return Buffer.from(await doc.save());
}

describe.skipIf(!hasTestDb)("upload cleaning in the worker (database)", () => {
  beforeEach(async () => {
    await resetDb(testDb());
  });
  afterAll(async () => {
    await testDb().$disconnect();
  });

  async function upload(body: Buffer, mimeType: string) {
    const db = testDb();
    const storage = memoryStorage();
    const key = `test/${Date.now()}-${Math.random()}`;
    await storage.put(key, body, mimeType);
    const file = await db.fileObject.create({ data: { kind: "MARKSHEET", storageKey: key, originalName: "marks.pdf", mimeType, sizeBytes: body.length, sha256: "abc" } });
    return { db, storage, key, file };
  }

  // No SANITIZER_URL: each file is cleaned in a throw-away local process.
  const sanitize = createSanitizer({});

  it("replaces the upload with the clean copy and keeps the original's hash", async () => {
    const original = await pdfWithScript();
    const { db, storage, key, file } = await upload(original, "application/pdf");
    const r = await scanFile(db, storage, sanitize, file.id);
    expect(r).toMatchObject({ scanStatus: "CLEAN", engine: "rebuild" });
    const stored = await storage.get(key);
    expect(stored.equals(original)).toBe(false);
    const clean = await PDFDocument.load(stored);
    expect(clean.catalog.has(PDFName.of("OpenAction"))).toBe(false);
    const row = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    expect(row).toMatchObject({ scanStatus: "CLEAN", sha256: "abc", sizeBytes: stored.length, scanNote: "removed /OpenAction" });
    // Already done: running again does nothing
    expect(await scanFile(db, storage, sanitize, file.id)).toEqual({ skipped: true });
  }, 30_000);

  it("refuses a file it can't rebuild, tells the uploader why and deletes the stored upload", async () => {
    const { db, storage, key, file } = await upload(Buffer.from("%PDF-1.4\nnot really a pdf"), "application/pdf");
    const r = await scanFile(db, storage, sanitize, file.id);
    expect(r).toMatchObject({ scanStatus: "INFECTED", code: "PDF_UNREADABLE" });
    const row = await db.fileObject.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.scanStatus).toBe("INFECTED");
    expect(row.scanNote).toContain("damaged or not a real PDF");
    await expect(storage.get(key)).rejects.toThrow();
  }, 30_000);

  it("marks the file FAILED and throws (so the job retries) when the sanitizer itself breaks", async () => {
    const { db, storage, file } = await upload(await pdfWithScript(), "application/pdf");
    const broken = async () => {
      throw new Error("sanitizer crashed");
    };
    await expect(scanFile(db, storage, broken, file.id)).rejects.toThrow("sanitizer crashed");
    expect((await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).scanStatus).toBe("FAILED");
    // The retry picks it up again
    expect(await scanFile(db, storage, sanitize, file.id)).toMatchObject({ scanStatus: "CLEAN" });
  }, 30_000);
});
