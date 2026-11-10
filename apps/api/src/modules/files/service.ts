import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import type { Db } from "../../lib/db.ts";
import type { Storage } from "../../lib/storage.ts";
import type { Enqueue } from "../../lib/enqueue.ts";
import type { AuthContext } from "../../http/auth-context.ts";
import { ApiError } from "../../http/errors.ts";
import type { FileKind } from "../../generated/prisma/client.ts";

/** What each kind of upload may be. The type is read from the file's bytes, not its name. */
const ALLOWED: Record<FileKind, string[]> = {
  MARKSHEET: ["application/pdf", "image/png", "image/jpeg"],
  RESUME: ["application/pdf"],
  PHOTO: ["image/png", "image/jpeg", "image/webp"],
  JD: ["application/pdf"],
  OFFER_LETTER: ["application/pdf"],
  IMPORT_SHEET: ["text/csv"],
  OTHER: ["application/pdf", "image/png", "image/jpeg"],
};
const EXT: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/csv": "csv" };
/** Kinds a person may upload for themselves through POST /files. */
export const SELF_UPLOAD_KINDS = ["MARKSHEET", "RESUME", "PHOTO"] as const;
/** Kinds only company HR and the TPO upload. */
export const COMPANY_UPLOAD_KINDS = ["OFFER_LETTER"] as const;

const LINK_SECONDS = 120;

export interface FilesDeps {
  db: Db;
  storage: Storage;
  enqueue: Enqueue;
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "file";
}

export function createFilesService({ db, storage, enqueue }: FilesDeps) {
  return {
    async upload(ownerId: string, kind: FileKind, file: { buffer: Buffer; originalname: string; size: number }) {
      const detected = await fileTypeFromBuffer(file.buffer);
      const mime = detected?.mime;
      const allowed = ALLOWED[kind];
      if (!mime || !allowed.includes(mime)) {
        const names = allowed.map((m) => EXT[m]?.toUpperCase()).join(", ");
        throw new ApiError(415, "FILE_TYPE_NOT_ALLOWED", `This file type isn't accepted here. Upload one of: ${names}.`);
      }
      const sha256 = createHash("sha256").update(file.buffer).digest("hex");
      const id = randomUUID();
      const key = `${kind.toLowerCase()}/${new Date().toISOString().slice(0, 7)}/${id}.${EXT[mime]}`;
      await storage.put(key, file.buffer, mime);
      const row = await db.fileObject.create({
        data: { id, ownerId, kind, storageKey: key, originalName: safeName(file.originalname), mimeType: mime, sizeBytes: file.size, sha256 },
      });
      // Virus scan runs in the documents worker; nobody else can open the file until it is marked clean.
      await enqueue("documents", "file.scan", { fileId: row.id });
      return { id: row.id, kind: row.kind, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, scanStatus: row.scanStatus };
    },

    /**
     * Short-lived download link. Allowed for: the owner; the TPO and staff; a volunteer or staff member
     * holding a claimed review task about the file's owner. Company access comes with the drives module.
     */
    async link(auth: AuthContext, fileId: string) {
      const file = await db.fileObject.findUnique({ where: { id: fileId } });
      if (!file) throw new ApiError(404, "NOT_FOUND", "File not found.");
      const isOwner = file.ownerId === auth.userId;
      let allowed = isOwner || auth.has("TPO") || auth.has("STAFF");
      if (!allowed && auth.has("VOLUNTEER") && file.ownerId) {
        const owner = await db.studentProfile.findUnique({ where: { userId: file.ownerId }, select: { id: true } });
        if (owner) {
          const task = await db.reviewTask.findFirst({
            where: { studentId: owner.id, claimedById: auth.userId, status: "CLAIMED", claimedUntil: { gt: new Date() } },
            select: { id: true },
          });
          allowed = !!task;
        }
      }
      // Company HR and interviewers: the resume of a student who joined (gave consent to) one of their company's drives.
      if (!allowed && file.kind === "RESUME" && file.ownerId && (auth.has("COMPANY_HR") || auth.has("INTERVIEWER"))) {
        const shared = await db.participation.findFirst({
          where: {
            consentAt: { not: null },
            student: { userId: file.ownerId, resumeFileId: file.id },
            drive: { company: { members: { some: { userId: auth.userId, active: true } } } },
          },
          select: { id: true },
        });
        allowed = !!shared;
      }
      if (!allowed) throw new ApiError(403, "FORBIDDEN", "You can't open this file.");
      if (file.scanStatus === "INFECTED") throw new ApiError(423, "FILE_BLOCKED", file.scanNote ?? "This file was refused and can't be opened.");
      if (file.scanStatus === "PENDING" && !isOwner) throw new ApiError(425, "FILE_CHECKING", "This file is still being checked. Try again in a minute.");
      return { url: await storage.signedUrl(file.storageKey, LINK_SECONDS, file.originalName), expiresInSeconds: LINK_SECONDS };
    },
  };
}

export type FilesService = ReturnType<typeof createFilesService>;
