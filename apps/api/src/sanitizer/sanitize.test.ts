import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import sharp from "sharp";
import { MAX_IMAGE_SIDE, MAX_PDF_PAGES, sanitize, SanitizeRejected } from "./sanitize.ts";
import { sanitizeInFreshProcess, SanitizerFailed } from "./run.ts";

/** A PDF that carries everything we don't want: a script that runs on open, an attached file, scripts on page notes. */
async function hostilePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  page.drawText("Semester 5 grade card", { x: 20, y: 200, size: 12 });
  doc.addPage([300, 300]);
  doc.addJavaScript("boot", "app.alert('owned')");
  await doc.attach(Buffer.from("MZ fake program"), "invoice.exe", { mimeType: "application/octet-stream" });
  const js = doc.context.obj({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.launchURL('http://evil.example')") });
  doc.catalog.set(PDFName.of("OpenAction"), doc.context.register(js));
  const note = (action: Record<string, string | PDFString>) => doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 50, 50], A: action }));
  page.node.set(
    PDFName.of("Annots"),
    doc.context.obj([
      note({ Type: "Action", S: "JavaScript", JS: PDFString.of("app.alert('click')") }),
      note({ Type: "Action", S: "Launch", F: PDFString.of("cmd.exe") }),
      note({ Type: "Action", S: "URI", URI: PDFString.of("javascript:alert(1)") }),
      note({ Type: "Action", S: "URI", URI: PDFString.of("https://github.com/someone") }),
    ]),
  );
  return Buffer.from(await doc.save({ useObjectStreams: true }));
}

/** Everything written in the file, including what sits inside compressed parts. */
function everythingIn(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o.toString())
    .join("\n");
}

describe("PDF sanitizing", () => {
  it("drops scripts, auto-run actions, attached files and risky page notes; keeps pages and plain web links", async () => {
    const evil = await hostilePdf();
    // The old check searched the raw file for "/JavaScript". Compressed, the word isn't there to find.
    expect(evil.toString("latin1")).not.toContain("/JavaScript");
    expect(everythingIn(await PDFDocument.load(evil))).toContain("/JavaScript");

    const out = await sanitize(evil, "application/pdf");
    expect(out.notes).toEqual(expect.arrayContaining(["removed /OpenAction", "removed /Names", "removed 3 page annotation(s)"]));

    const clean = await PDFDocument.load(out.bytes, { updateMetadata: false });
    expect(clean.getPageCount()).toBe(2);
    expect(clean.catalog.has(PDFName.of("OpenAction"))).toBe(false);
    expect(clean.catalog.has(PDFName.of("Names"))).toBe(false);
    const all = everythingIn(clean);
    for (const bad of ["JavaScript", "app.alert", "Launch", "cmd.exe", "invoice.exe", "EmbeddedFile", "javascript:"]) expect(all).not.toContain(bad);
    const annots = clean.getPage(0).node.Annots() as PDFArray;
    expect(annots.size()).toBe(1);
    expect((annots.lookup(0, PDFDict).lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI")) as PDFString).decodeText()).toBe("https://github.com/someone");
    expect(clean.getProducer()).toBe("Cyrus file sanitizer");
  });

  it("refuses password-protected, damaged and very long PDFs with a message for the uploader", async () => {
    const locked = await PDFDocument.create();
    locked.addPage();
    locked.context.trailerInfo.Encrypt = locked.context.register(locked.context.obj({ Filter: "Standard", V: 1, R: 2, O: PDFHexString.of("00".repeat(32)), U: PDFHexString.of("00".repeat(32)), P: -1 }));
    await expect(sanitize(await locked.save(), "application/pdf")).rejects.toMatchObject({ code: "PDF_ENCRYPTED", message: expect.stringContaining("password-protected") });

    await expect(sanitize(Buffer.from("%PDF-1.4\nthis is not really a pdf"), "application/pdf")).rejects.toMatchObject({ code: "PDF_UNREADABLE" });

    const long = await PDFDocument.create();
    for (let i = 0; i <= MAX_PDF_PAGES; i++) long.addPage([50, 50]);
    await expect(sanitize(await long.save(), "application/pdf")).rejects.toMatchObject({ code: "PDF_TOO_MANY_PAGES" });

    await expect(sanitize(Buffer.from("hello"), "text/plain")).rejects.toBeInstanceOf(SanitizeRejected);
  });
});

describe("image sanitizing", () => {
  const red = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "red" } });

  it("re-encodes the picture, dropping metadata and anything stuck on after it", async () => {
    const photo = await red(40, 30).withExif({ IFD0: { Copyright: "secret owner", Artist: "GPS 26.27,73.03" } }).jpeg().toBuffer();
    const withPayload = Buffer.concat([photo, Buffer.from("<?php system($_GET['c']); ?>")]);
    expect(withPayload.toString("latin1")).toContain("secret owner");
    const out = await sanitize(withPayload, "image/jpeg");
    expect(out.bytes.toString("latin1")).not.toContain("<?php");
    expect(out.bytes.toString("latin1")).not.toContain("secret owner");
    expect(out.notes).toContain("removed photo metadata");
    const meta = await sharp(out.bytes).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 40, height: 30 });
    expect(meta.exif).toBeUndefined();
  });

  it("shrinks very wide images and refuses fakes, wrong types and pixel bombs", async () => {
    const wide = await sanitize(await red(5000, 100).png().toBuffer(), "image/png");
    expect((await sharp(wide.bytes).metadata()).width).toBe(MAX_IMAGE_SIDE);

    await expect(sanitize(Buffer.from("definitely not an image"), "image/png")).rejects.toMatchObject({ code: "IMAGE_UNREADABLE" });
    await expect(sanitize(await red(10, 10).png().toBuffer(), "image/jpeg")).rejects.toMatchObject({ code: "IMAGE_UNREADABLE" });
    await expect(sanitize(await red(6400, 6400).png().toBuffer(), "image/png")).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    await expect(sanitize(await red(10, 10).gif().toBuffer(), "image/gif")).rejects.toMatchObject({ code: "TYPE_NOT_SUPPORTED" });
  });
});

describe("cleaning in a throw-away process", () => {
  it("returns the clean file, passes refusals on, and stops a run that takes too long", async () => {
    const out = await sanitizeInFreshProcess(await hostilePdf(), "application/pdf");
    expect(out.mimeType).toBe("application/pdf");
    expect(everythingIn(await PDFDocument.load(out.bytes))).not.toContain("JavaScript");
    expect(out.notes).toContain("removed /OpenAction");

    await expect(sanitizeInFreshProcess(Buffer.from("nope"), "image/png")).rejects.toMatchObject({ name: "SanitizeRejected", code: "IMAGE_UNREADABLE" });
    await expect(sanitizeInFreshProcess(await hostilePdf(), "application/pdf", 1)).rejects.toBeInstanceOf(SanitizerFailed);
  }, 30_000);
});
