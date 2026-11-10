/**
 * Makes an uploaded file safe by rebuilding it ("disarm"), instead of trying to detect what is bad in it.
 *
 *  - PDF: a new, empty PDF gets only the pages of the upload. Scripts, auto-run actions, attached
 *    files and forms live outside the pages, so they are never copied. Risky notes on a page
 *    (anything but a plain web/email link) are removed first.
 *  - Image: decoded and encoded again, which drops anything hidden in or after the image data
 *    and all metadata (camera, GPS).
 *
 * This file must stay self-contained (Node built-ins, pdf-lib, sharp; no project imports, no
 * TypeScript-only syntax): the sanitizer container runs it directly.
 */
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import sharp from "sharp";

export const MAX_PDF_PAGES = 30;
/** About 40 megapixels: a full A4 scan at 600 dpi. Bigger images are refused (decompression bombs). */
export const MAX_IMAGE_PIXELS = 40_000_000;
/** Longest side of a stored image, in pixels. */
export const MAX_IMAGE_SIDE = 4000;

export type RejectCode = "PDF_ENCRYPTED" | "PDF_UNREADABLE" | "PDF_TOO_MANY_PAGES" | "PDF_EMPTY" | "IMAGE_UNREADABLE" | "IMAGE_TOO_LARGE" | "TYPE_NOT_SUPPORTED";

/** The file itself is the problem (as opposed to the sanitizer breaking). The message is shown to the uploader. */
export class SanitizeRejected extends Error {
  code: RejectCode;
  constructor(code: RejectCode, message: string) {
    super(message);
    this.name = "SanitizeRejected";
    this.code = code;
  }
}

export interface Sanitized {
  bytes: Buffer;
  mimeType: string;
  /** What was taken out or changed, for the audit trail. */
  notes: string[];
}

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Keeps a page note only if it is a plain link to a web address or an email, or a jump inside the document. */
function keepAnnotation(annot: PDFDict): boolean {
  if (annot.get(PDFName.of("Subtype")) !== PDFName.of("Link")) return false;
  if (annot.has(PDFName.of("AA"))) return false;
  const action = annot.lookup(PDFName.of("A"));
  if (action === undefined) return true; // a /Dest jump inside the document
  if (!(action instanceof PDFDict)) return false;
  if (action.get(PDFName.of("S")) !== PDFName.of("URI") || action.has(PDFName.of("Next"))) return false;
  const uri = action.lookup(PDFName.of("URI"));
  const text = uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : "";
  return SAFE_LINK.test(text.trim());
}

export async function sanitizePdf(input: Uint8Array): Promise<Sanitized> {
  let source: PDFDocument;
  let pages: ReturnType<PDFDocument["getPages"]>;
  try {
    source = await PDFDocument.load(input, { updateMetadata: false });
    pages = source.getPages();
  } catch (e) {
    if (/encrypted/i.test(String((e as Error)?.message))) {
      throw new SanitizeRejected("PDF_ENCRYPTED", "This PDF is password-protected. Remove the password (open it and use Print → Save as PDF) and upload it again.");
    }
    throw new SanitizeRejected("PDF_UNREADABLE", "This PDF is damaged or not a real PDF. Export it again and upload the new file.");
  }
  if (!pages.length) throw new SanitizeRejected("PDF_EMPTY", "This PDF has no pages.");
  if (pages.length > MAX_PDF_PAGES) throw new SanitizeRejected("PDF_TOO_MANY_PAGES", `This PDF has ${pages.length} pages. Upload at most ${MAX_PDF_PAGES} pages.`);

  const notes: string[] = [];
  const catalog = source.catalog;
  for (const key of ["OpenAction", "AA", "Names", "AcroForm", "JavaScript", "Collection"]) {
    if (catalog.has(PDFName.of(key))) notes.push(`removed /${key}`);
  }

  // Clean each page before copying, so nothing risky is reachable from a page and nothing risky gets copied.
  let dropped = 0;
  for (const page of pages) {
    page.node.delete(PDFName.of("AA"));
    const annots = page.node.Annots();
    if (!annots) continue;
    const kept: ReturnType<PDFArray["get"]>[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (annot instanceof PDFDict && keepAnnotation(annot)) kept.push(annots.get(i));
      else dropped += 1;
    }
    if (kept.length) page.node.set(PDFName.of("Annots"), source.context.obj(kept));
    else page.node.delete(PDFName.of("Annots"));
  }
  if (dropped) notes.push(`removed ${dropped} page annotation(s)`);

  const clean = await PDFDocument.create();
  const copied = await clean.copyPages(source, source.getPageIndices());
  for (const page of copied) clean.addPage(page);
  clean.setProducer("Cyrus file sanitizer");
  clean.setCreator("Cyrus");
  const bytes = await clean.save({ useObjectStreams: true });
  return { bytes: Buffer.from(bytes), mimeType: "application/pdf", notes };
}

const IMAGE_FORMATS = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" } as const;

export async function sanitizeImage(input: Uint8Array, mimeType: string): Promise<Sanitized> {
  const format = IMAGE_FORMATS[mimeType as keyof typeof IMAGE_FORMATS];
  if (!format) throw new SanitizeRejected("TYPE_NOT_SUPPORTED", "This kind of image isn't accepted. Upload a JPG, PNG or WebP.");
  try {
    const image = sharp(input, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", animated: false });
    const meta = await image.metadata();
    if (meta.format !== format) throw new SanitizeRejected("IMAGE_UNREADABLE", "This file isn't the kind of image its name says. Export it again and upload the new file.");
    const pipeline = image
      .rotate() // apply the camera's orientation, then drop the metadata
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true });
    const out = format === "jpeg" ? pipeline.jpeg({ quality: 90 }) : format === "png" ? pipeline.png() : pipeline.webp({ quality: 90 });
    const bytes = await out.toBuffer();
    const notes = [(meta.width ?? 0) > MAX_IMAGE_SIDE || (meta.height ?? 0) > MAX_IMAGE_SIDE ? `resized from ${meta.width}x${meta.height}` : "", meta.exif ? "removed photo metadata" : ""].filter(Boolean);
    return { bytes, mimeType, notes };
  } catch (e) {
    if (e instanceof SanitizeRejected) throw e;
    if (/pixel limit/i.test(String((e as Error)?.message))) throw new SanitizeRejected("IMAGE_TOO_LARGE", "This image is too large. Upload one under 40 megapixels.");
    throw new SanitizeRejected("IMAGE_UNREADABLE", "This image is damaged or not a real image. Export it again and upload the new file.");
  }
}

export async function sanitize(input: Uint8Array, mimeType: string): Promise<Sanitized> {
  if (mimeType === "application/pdf") return sanitizePdf(input);
  if (mimeType in IMAGE_FORMATS) return sanitizeImage(input, mimeType);
  throw new SanitizeRejected("TYPE_NOT_SUPPORTED", "This kind of file isn't accepted.");
}
