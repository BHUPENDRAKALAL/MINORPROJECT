import type { Db } from "../../lib/db.ts";
import type { Mailer } from "../../lib/mail.ts";
import type { Storage } from "../../lib/storage.ts";
import type { Env } from "../../config/env.ts";
import type { AuthContext } from "../../http/auth-context.ts";
import { ApiError } from "../../http/errors.ts";
import { audit } from "../../lib/audit.ts";
import { emit } from "../../lib/outbox.ts";
import { notifyInApp, sendAfterCommit } from "../../lib/notify.ts";

export interface OffersDeps {
  db: Db;
  mailer: Mailer;
  storage: Storage;
  env: Env;
  now?: () => number;
}

const LINK_SECONDS = 120;
type OfferRow = { status: string; respondBy: Date };

/** SENT past its deadline counts as EXPIRED (no job needed to flip it). */
export function effectiveStatus(o: OfferRow, at: number): string {
  return o.status === "SENT" && o.respondBy.getTime() < at ? "EXPIRED" : o.status;
}

export function createOffersService({ db, mailer, storage, env, now = Date.now }: OffersDeps) {
  const link = (path: string) => `${env.WEB_APP_URL}${path}`;

  /** A drive the caller manages: the TPO, or HR of the drive's company. */
  async function manageDrive(auth: AuthContext, driveId: string) {
    const drive = await db.drive.findUnique({ where: { id: driveId }, include: { company: { select: { id: true, name: true } } } });
    if (!drive) throw new ApiError(404, "NOT_FOUND", "Drive not found.");
    if (auth.has("TPO")) return drive;
    const hr = await db.companyMember.findFirst({ where: { userId: auth.userId, companyId: drive.companyId, role: "HR", active: true } });
    if (!hr) throw new ApiError(404, "NOT_FOUND", "Drive not found.");
    return drive;
  }

  const view = (o: { id: string; status: string; respondBy: Date; respondedAt: Date | null; ctcLpa: number | null; joiningDate: Date | null; roleTitle: string; createdAt: Date; updatedAt: Date; revokeReason: string | null }) => ({
    id: o.id,
    status: effectiveStatus(o, now()),
    roleTitle: o.roleTitle,
    ctcLpa: o.ctcLpa,
    joiningDate: o.joiningDate,
    respondBy: o.respondBy,
    respondedAt: o.respondedAt,
    revokeReason: o.revokeReason,
    sentAt: o.createdAt,
    updatedAt: o.updatedAt,
  });

  /** Selected students and their offers, for HR's Offers tab. */
  async function list(auth: AuthContext, driveId: string) {
    const drive = await manageDrive(auth, driveId);
    const rows = await db.participation.findMany({
      where: { driveId, status: { in: ["SELECTED", "OFFERED", "PLACED", "OFFER_DECLINED"] } },
      orderBy: { student: { rollNo: "asc" } },
      select: {
        id: true,
        status: true,
        student: { select: { name: true, rollNo: true, branch: true, batch: true } },
        offer: { select: { id: true, status: true, respondBy: true, respondedAt: true, ctcLpa: true, joiningDate: true, roleTitle: true, createdAt: true, updatedAt: true, revokeReason: true, file: { select: { originalName: true } } } },
      },
    });
    const policy = await db.placementPolicy.findUnique({ where: { id: "default" } });
    return {
      drive: { id: drive.id, roleTitle: drive.roleTitle, ctcLpa: drive.ctcLpa, status: drive.status },
      responseDays: policy?.offerResponseDays ?? 7,
      canSend: ["RESULTS_DECLARED", "ONGOING"].includes(drive.status),
      selected: rows.map((r) => ({
        participationId: r.id,
        status: r.status,
        student: r.student,
        offer: r.offer ? { ...view(r.offer), fileName: r.offer.file.originalName } : null,
      })),
    };
  }

  /**
   * Send (or replace) a selected student's offer letter. The PDF must be an OFFER_LETTER upload by
   * the sender. A replaced letter keeps the offer but restarts nothing else; the student is told.
   */
  async function send(
    auth: AuthContext,
    driveId: string,
    body: { participationId: string; fileId: string; ctcLpa?: number | null; joiningDate?: Date | null; respondBy?: Date | null },
  ) {
    const drive = await manageDrive(auth, driveId);
    if (!["RESULTS_DECLARED", "ONGOING"].includes(drive.status)) throw new ApiError(409, "BAD_STATE", drive.status === "CLOSED" ? "This drive is closed." : "Offers can be sent once students are selected.");
    const p = await db.participation.findFirst({ where: { id: body.participationId, driveId }, include: { offer: true, student: { select: { id: true, userId: true } } } });
    if (!p) throw new ApiError(404, "NOT_FOUND", "This student isn't in the drive.");
    const replacing = p.offer && effectiveStatus(p.offer, now()) === "SENT";
    if (!replacing && p.status !== "SELECTED") throw new ApiError(409, "NOT_SELECTED", p.status === "PLACED" ? "This student already accepted the offer." : "Only selected students get offers.");
    const file = await db.fileObject.findUnique({ where: { id: body.fileId } });
    if (!file || file.kind !== "OFFER_LETTER" || file.ownerId !== auth.userId) throw new ApiError(400, "BAD_FILE", "Upload the offer letter PDF first.");
    if (file.scanStatus === "INFECTED") throw new ApiError(423, "FILE_BLOCKED", "This file failed the virus check. Upload a clean copy.");
    const policy = await db.placementPolicy.findUnique({ where: { id: "default" } });
    const respondBy = body.respondBy ?? new Date(now() + (policy?.offerResponseDays ?? 7) * 86_400_000);
    if (respondBy.getTime() < now() + 3_600_000) throw new ApiError(400, "VALIDATION_FAILED", "Give the student at least an hour to answer.", { issues: [{ path: "respondBy", message: "Pick a later date." }] });

    const email = await db.$transaction(async (tx) => {
      const data = { fileId: file.id, ctcLpa: body.ctcLpa ?? drive.ctcLpa, joiningDate: body.joiningDate ?? null, respondBy, uploadedById: auth.userId, roleTitle: drive.roleTitle };
      const offer = p.offer
        ? await tx.offer.update({ where: { id: p.offer.id }, data: { ...data, status: "SENT", respondedAt: null, revokeReason: null } })
        : await tx.offer.create({ data: { ...data, driveId, participationId: p.id, studentId: p.student.id, companyId: drive.companyId } });
      await tx.participation.update({ where: { id: p.id }, data: { status: "OFFERED" } });
      await audit(tx, { actorId: auth.userId, action: replacing ? "offer.replaced" : "offer.sent", entityType: "Offer", entityId: offer.id });
      await emit(tx, "offer.uploaded", { offerId: offer.id, driveId });
      return notifyInApp(tx, {
        userId: p.student.userId,
        channel: "OFFERS",
        title: replacing ? `${drive.company.name}: your offer letter was updated` : `${drive.company.name}: you have an offer!`,
        body: `${drive.roleTitle}. Open the drive to read the letter and accept or decline by ${respondBy.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}.`,
        link: link(`/student/drives/${driveId}`),
      });
    });
    await sendAfterCommit(mailer, [email]);
    return list(auth, driveId);
  }

  async function revoke(auth: AuthContext, offerId: string, reason: string) {
    const o = await db.offer.findUnique({ where: { id: offerId }, include: { student: { select: { userId: true } }, company: { select: { name: true } } } });
    if (!o) throw new ApiError(404, "NOT_FOUND", "Offer not found.");
    await manageDrive(auth, o.driveId);
    if (effectiveStatus(o, now()) !== "SENT") throw new ApiError(409, "BAD_STATE", "Only an offer the student hasn't answered can be withdrawn. Talk to the placement office.");
    const email = await db.$transaction(async (tx) => {
      await tx.offer.update({ where: { id: offerId }, data: { status: "REVOKED", revokeReason: reason } });
      await tx.participation.update({ where: { id: o.participationId }, data: { status: "SELECTED" } });
      await audit(tx, { actorId: auth.userId, action: "offer.revoked", entityType: "Offer", entityId: offerId, reason });
      return notifyInApp(tx, { userId: o.student.userId, channel: "OFFERS", title: `${o.company.name}: offer withdrawn`, body: reason, link: link(`/student/drives/${o.driveId}`) });
    });
    await sendAfterCommit(mailer, [email]);
    return list(auth, o.driveId);
  }

  /** The letter, through a 2-minute link: only the student, the TPO and the company's HR. */
  async function letter(auth: AuthContext, offerId: string) {
    const o = await db.offer.findUnique({ where: { id: offerId }, include: { file: true, student: { select: { userId: true } } } });
    if (!o) throw new ApiError(404, "NOT_FOUND", "Offer not found.");
    const student = o.student.userId === auth.userId;
    const hr = !student && !auth.has("TPO") ? await db.companyMember.findFirst({ where: { userId: auth.userId, companyId: o.companyId, role: "HR", active: true } }) : null;
    if (!(student || auth.has("TPO") || hr)) throw new ApiError(404, "NOT_FOUND", "Offer not found.");
    if (student && o.status === "REVOKED") throw new ApiError(410, "OFFER_WITHDRAWN", "This offer was withdrawn.");
    if (o.file.scanStatus === "INFECTED") throw new ApiError(423, "FILE_BLOCKED", "This file failed the virus check and can't be opened.");
    if (o.file.scanStatus === "PENDING" && student) throw new ApiError(425, "FILE_CHECKING", "The letter is still being checked. Try again in a minute.");
    return { url: await storage.signedUrl(o.file.storageKey, LINK_SECONDS, o.file.originalName), expiresInSeconds: LINK_SECONDS };
  }

  /** Student: accept or decline. Accepting places the student and records the placement. */
  async function respond(userId: string, offerId: string, accept: boolean) {
    const o = await db.offer.findUnique({
      where: { id: offerId },
      include: { student: { select: { id: true, userId: true, placementStatus: true, branch: true, batch: true, rollNo: true, name: true } }, company: { select: { name: true } } },
    });
    if (!o || o.student.userId !== userId) throw new ApiError(404, "NOT_FOUND", "Offer not found.");
    const status = effectiveStatus(o, now());
    if (status === "EXPIRED") throw new ApiError(409, "OFFER_EXPIRED", "The last date to answer this offer has passed. Talk to the placement office.");
    if (status !== "SENT") throw new ApiError(409, "ALREADY_ANSWERED", "You've already answered this offer.");
    if (accept && o.student.placementStatus === "PLACED") {
      // The college's one-offer rule: a second offer only counts if it is a "dream" offer.
      const policy = await db.placementPolicy.findUnique({ where: { id: "default" } });
      const dream = policy?.dreamOfferMinCtcLpa != null && o.ctcLpa != null && o.ctcLpa >= policy.dreamOfferMinCtcLpa;
      if (!dream) throw new ApiError(409, "ALREADY_PLACED", "You've already accepted an offer. Talk to the placement office before accepting another.");
    }
    const at = new Date(now());
    const emails = await db.$transaction(async (tx) => {
      await tx.offer.update({ where: { id: offerId }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: at } });
      await tx.participation.update({ where: { id: o.participationId }, data: { status: accept ? "PLACED" : "OFFER_DECLINED" } });
      if (accept) {
        await tx.studentProfile.update({ where: { id: o.student.id }, data: { placementStatus: "PLACED" } });
        await tx.placementRecord.create({
          data: { studentId: o.student.id, companyId: o.companyId, offerId: o.id, studentRollNo: o.student.rollNo, companyName: o.company.name, roleTitle: o.roleTitle, ctcLpa: o.ctcLpa, branch: o.student.branch, batch: o.student.batch, placedAt: at },
        });
      }
      await audit(tx, { actorId: userId, action: accept ? "offer.accepted" : "offer.declined", entityType: "Offer", entityId: offerId });
      await emit(tx, accept ? "offer.accepted" : "offer.declined", { offerId, driveId: o.driveId });
      return [
        await notifyInApp(tx, {
          userId: o.uploadedById,
          channel: "OFFERS",
          title: `${o.student.name} ${accept ? "accepted" : "declined"} the offer`,
          body: `${o.roleTitle}: ${o.student.name} (${o.student.rollNo}) ${accept ? "accepted" : "declined"} your offer.`,
          link: link(`/company/drives/${o.driveId}?tab=offers`),
        }),
      ];
    });
    await sendAfterCommit(mailer, emails);
    return { status: accept ? "ACCEPTED" : "DECLINED" };
  }

  /** The student's offer for one drive (shown on the drive page). */
  async function mine(participationId: string) {
    const o = await db.offer.findUnique({ where: { participationId } });
    if (!o || o.status === "REVOKED") return null;
    return view(o);
  }

  /** TPO closes a drive: HR becomes read-only; unanswered offers stay answerable until their deadline. */
  async function close(auth: AuthContext, driveId: string) {
    const drive = await manageDrive(auth, driveId);
    if (!auth.has("TPO")) throw new ApiError(403, "FORBIDDEN", "Only the TPO closes a drive.");
    if (drive.status !== "RESULTS_DECLARED") throw new ApiError(409, "BAD_STATE", "A drive can be closed once its final results are out.");
    await db.$transaction(async (tx) => {
      await tx.drive.update({ where: { id: driveId }, data: { status: "CLOSED", closedAt: new Date(now()) } });
      await audit(tx, { actorId: auth.userId, action: "drive.closed", entityType: "Drive", entityId: driveId });
      await emit(tx, "drive.closed", { driveId });
    });
    return { status: "CLOSED" };
  }

  return { list, send, revoke, letter, respond, mine, close };
}

export type OffersService = ReturnType<typeof createOffersService>;
