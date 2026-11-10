import type { Db } from "../../lib/db.ts";
import { audit } from "../../lib/audit.ts";
import { emit } from "../../lib/outbox.ts";
import { ApiError } from "../../http/errors.ts";
import type { DocumentType, Prisma } from "../../generated/prisma/client.ts";

export interface StudentsDeps {
  db: Db;
}

export interface AcademicInput {
  cgpa: number;
  activeBacklogs: number;
  totalBacklogs: number;
  tenthPercent: number;
  twelfthPercent?: number | null;
  diplomaPercent?: number | null;
  semester?: number | null;
}

export interface ProfilePatch {
  name?: string;
  phone?: string | null;
  gender?: string | null;
  degree?: string | null;
  skills?: string[];
  links?: { label: string; url: string }[];
  resumeFileId?: string | null;
  photoFileId?: string | null;
}

/** States in which the student may change marks and documents. */
const EDITABLE = new Set(["PROFILE_INCOMPLETE", "REJECTED"]);

/** What must be uploaded before the profile can be sent for verification. */
export function missingForSubmit(docTypes: DocumentType[], hasAcademics: boolean): string[] {
  const missing: string[] = [];
  if (!hasAcademics) missing.push("Your marks (CGPA, backlogs, 10th percentage)");
  if (!docTypes.includes("MARKSHEET_10")) missing.push("Class 10 marksheet");
  if (!docTypes.includes("MARKSHEET_12") && !docTypes.includes("DIPLOMA")) missing.push("Class 12 or diploma marksheet");
  if (!docTypes.includes("SEMESTER_MARKSHEET")) missing.push("At least one semester marksheet");
  return missing;
}

export function createStudentsService({ db }: StudentsDeps) {
  async function profileFor(userId: string) {
    const student = await db.studentProfile.findUnique({ where: { userId } });
    if (!student) throw new ApiError(404, "NOT_A_STUDENT", "There is no student profile on this account.");
    return student;
  }

  /** The single editable draft of the marks (status PENDING), if any. */
  function draftOf(studentId: string, tx: Prisma.TransactionClient | Db = db) {
    return tx.academicRecord.findFirst({ where: { studentId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  }

  async function openTask(studentId: string) {
    return db.reviewTask.findFirst({
      where: { studentId, type: { in: ["STUDENT_VERIFICATION", "ACADEMIC_UPDATE"] }, status: { notIn: ["CLOSED"] } },
      orderBy: { createdAt: "desc" },
    });
  }

  function assertEditable(status: string) {
    if (!EDITABLE.has(status)) {
      throw new ApiError(
        409,
        "PROFILE_LOCKED",
        status === "VERIFIED"
          ? "Your marks are verified and locked. Send a change request to update them."
          : "Your profile is being verified. Withdraw the submission first if you need to change something.",
      );
    }
  }

  return {
    async getMine(userId: string) {
      const student = await profileFor(userId);
      const [user, draft, verified, documents, task, lastReject] = await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true } }),
        draftOf(student.id),
        db.academicRecord.findFirst({ where: { studentId: student.id, status: "VERIFIED" }, orderBy: { createdAt: "desc" } }),
        db.studentDocument.findMany({
          where: { studentId: student.id, status: { not: "SUPERSEDED" } },
          orderBy: { createdAt: "asc" },
          include: { file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scanStatus: true, scanNote: true } } },
        }),
        openTask(student.id),
        db.reviewTask.findFirst({
          where: { studentId: student.id, type: "STUDENT_VERIFICATION", status: "CLOSED", decision: "REJECT" },
          orderBy: { closedAt: "desc" },
          select: { reasonCode: true, note: true, closedAt: true },
        }),
      ]);
      const docTypes = documents.map((d) => d.type);
      const canWithdraw =
        student.status === "PENDING_VERIFICATION" &&
        !!task &&
        task.type === "STUDENT_VERIFICATION" &&
        (task.status === "OPEN" || (task.status === "CLAIMED" && !!task.claimedUntil && task.claimedUntil < new Date()));
      return {
        profile: { ...student, email: user.email, phone: user.phone },
        draft,
        verified,
        documents: documents.map((d) => ({ id: d.id, type: d.type, semester: d.semester, status: d.status, flagged: !!d.flags, file: d.file })),
        review: task ? { status: task.status, type: task.type, submittedAt: task.createdAt } : null,
        pendingUpdate: student.status === "VERIFIED" && !!draft,
        rejection: student.status === "REJECTED" && lastReject ? { reasonCode: lastReject.reasonCode, note: lastReject.note, at: lastReject.closedAt } : null,
        missing: EDITABLE.has(student.status) ? missingForSubmit(docTypes, !!draft) : [],
        canEdit: EDITABLE.has(student.status),
        canWithdraw,
      };
    },

    async updateMine(userId: string, patch: ProfilePatch) {
      const student = await profileFor(userId);
      for (const [field, kind] of [["resumeFileId", "RESUME"], ["photoFileId", "PHOTO"]] as const) {
        const fileId = patch[field];
        if (fileId) {
          const f = await db.fileObject.findUnique({ where: { id: fileId } });
          if (!f || f.ownerId !== userId || f.kind !== kind) throw new ApiError(400, "BAD_FILE", `That ${kind.toLowerCase()} file isn't yours or isn't the right kind.`);
        }
      }
      await db.$transaction(async (tx) => {
        await tx.studentProfile.update({
          where: { id: student.id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.gender !== undefined ? { gender: patch.gender } : {}),
            ...(patch.degree !== undefined ? { degree: patch.degree } : {}),
            ...(patch.skills !== undefined ? { skills: patch.skills } : {}),
            ...(patch.links !== undefined ? { links: patch.links } : {}),
            ...(patch.resumeFileId !== undefined ? { resumeFileId: patch.resumeFileId } : {}),
            ...(patch.photoFileId !== undefined ? { photoFileId: patch.photoFileId } : {}),
          },
        });
        if (patch.phone !== undefined) await tx.user.update({ where: { id: userId }, data: { phone: patch.phone } });
      });
      return this.getMine(userId);
    },

    /** Saves the marks as a draft. Only while the profile is incomplete or was rejected. */
    async saveAcademics(userId: string, input: AcademicInput) {
      const student = await profileFor(userId);
      assertEditable(student.status);
      if (input.totalBacklogs < input.activeBacklogs) {
        throw new ApiError(400, "VALIDATION_FAILED", "Some fields are missing or invalid.", {
          issues: [{ path: "totalBacklogs", message: "Total backlogs can't be less than active backlogs." }],
        });
      }
      const draft = await draftOf(student.id);
      const data = {
        cgpa: input.cgpa,
        activeBacklogs: input.activeBacklogs,
        totalBacklogs: input.totalBacklogs,
        tenthPercent: input.tenthPercent,
        twelfthPercent: input.twelfthPercent ?? null,
        diplomaPercent: input.diplomaPercent ?? null,
        semester: input.semester ?? null,
      };
      if (draft) await db.academicRecord.update({ where: { id: draft.id }, data });
      else await db.academicRecord.create({ data: { ...data, studentId: student.id, source: "SELF", status: "PENDING" } });
      return this.getMine(userId);
    },

    /** Attaches an uploaded marksheet. A newer upload of the same type and semester replaces the older one. */
    async addDocument(userId: string, input: { fileId: string; type: DocumentType; semester?: number | null }) {
      const student = await profileFor(userId);
      assertEditable(student.status);
      if (input.type === "SEMESTER_MARKSHEET" && !input.semester) {
        throw new ApiError(400, "VALIDATION_FAILED", "Some fields are missing or invalid.", { issues: [{ path: "semester", message: "Pick the semester." }] });
      }
      const file = await db.fileObject.findUnique({ where: { id: input.fileId } });
      if (!file || file.ownerId !== userId) throw new ApiError(404, "NOT_FOUND", "File not found.");
      if (file.kind !== "MARKSHEET") throw new ApiError(400, "BAD_FILE", "Upload this as a marksheet.");

      // Same file already used by another student? Flag it for the reviewer (never shown as an accusation).
      const others = await db.studentDocument.findMany({
        where: { file: { sha256: file.sha256 }, studentId: { not: student.id } },
        select: { studentId: true },
      });
      const flags = others.length ? { duplicateOf: [...new Set(others.map((o) => o.studentId))] } : undefined;

      await db.$transaction(async (tx) => {
        await tx.studentDocument.updateMany({
          where: { studentId: student.id, type: input.type, semester: input.semester ?? null, status: { not: "SUPERSEDED" } },
          data: { status: "SUPERSEDED" },
        });
        await tx.studentDocument.create({
          data: { studentId: student.id, fileId: file.id, type: input.type, semester: input.semester ?? null, ...(flags ? { flags } : {}) },
        });
      });
      return this.getMine(userId);
    },

    async removeDocument(userId: string, documentId: string) {
      const student = await profileFor(userId);
      assertEditable(student.status);
      const doc = await db.studentDocument.findUnique({ where: { id: documentId } });
      if (!doc || doc.studentId !== student.id) throw new ApiError(404, "NOT_FOUND", "Document not found.");
      await db.studentDocument.update({ where: { id: doc.id }, data: { status: "SUPERSEDED" } });
      return this.getMine(userId);
    },

    /** Sends the profile for verification: creates a review task for the review team. */
    async submit(userId: string) {
      const student = await profileFor(userId);
      assertEditable(student.status);
      const [draft, docs] = await Promise.all([
        draftOf(student.id),
        db.studentDocument.findMany({ where: { studentId: student.id, status: { not: "SUPERSEDED" } } }),
      ]);
      const missing = missingForSubmit(docs.map((d) => d.type), !!draft);
      if (missing.length) throw new ApiError(400, "PROFILE_INCOMPLETE", "Some things are still missing.", { missing });
      const flagged = docs.some((d) => !!d.flags);
      const resubmission = student.status === "REJECTED";

      await db.$transaction(async (tx) => {
        await tx.studentProfile.update({ where: { id: student.id }, data: { status: "PENDING_VERIFICATION", rejectionReason: null } });
        const task = await tx.reviewTask.create({
          data: {
            type: "STUDENT_VERIFICATION",
            risk: flagged ? "HIGH" : resubmission ? "MEDIUM" : "LOW",
            priority: flagged ? 30 : 10,
            subjectType: "StudentProfile",
            subjectId: student.id,
            studentId: student.id,
            branch: student.branch,
            batch: student.batch,
          },
        });
        await audit(tx, { actorId: userId, action: "student.submitted", entityType: "StudentProfile", entityId: student.id, after: { taskId: task.id } });
        await emit(tx, "student.submitted", { studentId: student.id, taskId: task.id });
      });
      return this.getMine(userId);
    },

    /** Takes the submission back, only while no reviewer is working on it. */
    async withdraw(userId: string) {
      const student = await profileFor(userId);
      if (student.status !== "PENDING_VERIFICATION") throw new ApiError(409, "NOT_PENDING", "There is no submission to withdraw.");
      await db.$transaction(async (tx) => {
        const closed = await tx.reviewTask.updateMany({
          where: {
            studentId: student.id,
            type: "STUDENT_VERIFICATION",
            OR: [{ status: "OPEN" }, { status: "CLAIMED", claimedUntil: { lt: new Date() } }],
          },
          data: { status: "CLOSED", closedAt: new Date(), note: "Withdrawn by the student", claimedById: null, claimedUntil: null },
        });
        if (closed.count === 0) {
          throw new ApiError(409, "IN_REVIEW", "A reviewer is checking your profile right now, so it can't be withdrawn.");
        }
        await tx.studentProfile.update({ where: { id: student.id }, data: { status: "PROFILE_INCOMPLETE" } });
        await audit(tx, { actorId: userId, action: "student.withdrew", entityType: "StudentProfile", entityId: student.id });
      });
      return this.getMine(userId);
    },

    /** After verification: ask to change marks (e.g. a new semester). Goes to staff as a high-risk task. */
    async requestAcademicUpdate(userId: string, input: AcademicInput, note?: string) {
      const student = await profileFor(userId);
      if (student.status !== "VERIFIED") throw new ApiError(409, "NOT_VERIFIED", "Change requests are for verified profiles. Edit your marks directly instead.");
      if (await draftOf(student.id)) throw new ApiError(409, "REQUEST_PENDING", "You already have a change request waiting for review.");
      await db.$transaction(async (tx) => {
        const rec = await tx.academicRecord.create({
          data: {
            studentId: student.id,
            cgpa: input.cgpa,
            activeBacklogs: input.activeBacklogs,
            totalBacklogs: input.totalBacklogs,
            tenthPercent: input.tenthPercent,
            twelfthPercent: input.twelfthPercent ?? null,
            diplomaPercent: input.diplomaPercent ?? null,
            semester: input.semester ?? null,
            source: "SELF",
            status: "PENDING",
            reason: note ?? null,
          },
        });
        await tx.reviewTask.create({
          data: {
            type: "ACADEMIC_UPDATE",
            risk: "HIGH",
            priority: 20,
            subjectType: "AcademicRecord",
            subjectId: rec.id,
            studentId: student.id,
            branch: student.branch,
            batch: student.batch,
          },
        });
        await audit(tx, { actorId: userId, action: "student.update_requested", entityType: "AcademicRecord", entityId: rec.id });
      });
      return this.getMine(userId);
    },
  };
}

export type StudentsService = ReturnType<typeof createStudentsService>;
