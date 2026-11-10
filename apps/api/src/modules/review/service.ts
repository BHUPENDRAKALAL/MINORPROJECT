import { REJECT_REASONS, TASK_LOCK_MINUTES, type RejectReason } from "@cyrus/shared";
import type { Db } from "../../lib/db.ts";
import type { Mailer } from "../../lib/mail.ts";
import type { Storage } from "../../lib/storage.ts";
import { audit } from "../../lib/audit.ts";
import { emit } from "../../lib/outbox.ts";
import { notifyInApp, sendAfterCommit } from "../../lib/notify.ts";
import type { AuthContext } from "../../http/auth-context.ts";
import { ApiError } from "../../http/errors.ts";
import { Prisma, type ReviewTask } from "../../generated/prisma/client.ts";
import { needsSecondCheck, reviewerFrom, taskFilterFor, type Reviewer } from "./rules.ts";

export interface ReviewDeps {
  db: Db;
  mailer: Mailer;
  storage: Storage;
  env: { WEB_APP_URL: string };
  /** Injected so tests can control spot checks. */
  random?: () => number;
}

type Tx = Prisma.TransactionClient;
type Decision = "APPROVE" | "REJECT";
type Email = { to: string; subject: string; text: string } | null;

const LOCK_MS = TASK_LOCK_MINUTES * 60_000;
const DOC_LINK_SECONDS = 15 * 60;

export function reasonText(code: string | null | undefined, note: string | null | undefined): string {
  const label = code && code in REJECT_REASONS ? REJECT_REASONS[code as RejectReason].label : "Your profile needs changes";
  return note ? `${label}. ${note}` : label;
}

export function createReviewService(deps: ReviewDeps) {
  const { db, mailer, storage, env } = deps;
  const random = deps.random ?? Math.random;

  async function reviewerOf(auth: AuthContext): Promise<Reviewer> {
    const own = await db.studentProfile.findUnique({ where: { userId: auth.userId }, select: { id: true, branch: true, batch: true } });
    const r = reviewerFrom(auth, own);
    if (!r || !taskFilterFor(r)) throw new ApiError(403, "NOT_A_REVIEWER", "You aren't on the review team, or you don't have permission to review.");
    if (r.kind !== "TPO") {
      const u = await db.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { pledgeAcceptedAt: true } });
      if (!u.pledgeAcceptedAt) throw new ApiError(403, "PLEDGE_REQUIRED", "Read the guide and accept the confidentiality pledge before reviewing.");
    }
    return r;
  }

  /** The SQL conditions that say "this reviewer may take this task". */
  function eligibleSql(r: Reviewer) {
    const f = taskFilterFor(r)!;
    const parts: Prisma.Sql[] = [Prisma.sql`t."type"::text = ANY(${f.types})`];
    const statusOk = f.includeEscalated
      ? Prisma.sql`(t."status" = 'OPEN' OR t."status" = 'ESCALATED' OR (t."status" = 'CLAIMED' AND t."claimedUntil" < now()))`
      : Prisma.sql`(t."status" = 'OPEN' OR (t."status" = 'CLAIMED' AND t."claimedUntil" < now()))`;
    parts.push(statusOk);
    if (f.verificationRisks) parts.push(Prisma.sql`(t."type" <> 'STUDENT_VERIFICATION' OR t."risk"::text = ANY(${f.verificationRisks}))`);
    if (r.scope.branches?.length) parts.push(Prisma.sql`t."branch" = ANY(${r.scope.branches})`);
    if (r.scope.batches?.length) parts.push(Prisma.sql`t."batch" = ANY(${r.scope.batches})`);
    if (r.ownStudent) {
      // Never review yourself; volunteers also skip their own branch + batch (classmates).
      parts.push(Prisma.sql`(t."studentId" IS NULL OR t."studentId" <> ${r.ownStudent.id}::uuid)`);
      if (r.kind === "VOLUNTEER") {
        parts.push(Prisma.sql`NOT (t."branch" IS NOT DISTINCT FROM ${r.ownStudent.branch} AND t."batch" IS NOT DISTINCT FROM ${r.ownStudent.batch})`);
      }
    }
    // A second check must be done by someone other than the first reviewer.
    parts.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "ReviewTask" p WHERE p."id" = t."parentTaskId" AND p."decidedById" = ${r.userId}::uuid)`);
    return Prisma.join(parts, " AND ");
  }

  async function heldBy(userId: string) {
    return db.reviewTask.findFirst({ where: { claimedById: userId, status: "CLAIMED", claimedUntil: { gt: new Date() } } });
  }

  async function docsFor(studentId: string) {
    const docs = await db.studentDocument.findMany({
      where: { studentId, status: { not: "SUPERSEDED" } },
      orderBy: [{ type: "asc" }, { semester: "asc" }],
      include: { file: true },
    });
    return Promise.all(
      docs.map(async (d) => ({
        id: d.id,
        type: d.type,
        semester: d.semester,
        status: d.status,
        flags: d.flags,
        file: {
          id: d.file.id,
          originalName: d.file.originalName,
          mimeType: d.file.mimeType,
          scanStatus: d.file.scanStatus,
          url: d.file.scanStatus === "CLEAN" ? await storage.signedUrl(d.file.storageKey, DOC_LINK_SECONDS, d.file.originalName) : null,
        },
      })),
    );
  }

  /** Everything a reviewer needs on one screen, without personal data they don't need (no phone, email, resume). */
  async function details(task: ReviewTask): Promise<Record<string, unknown>> {
    const base = {
      id: task.id,
      type: task.type,
      risk: task.risk,
      status: task.status,
      createdAt: task.createdAt,
      claimedUntil: task.claimedUntil,
      escalationNote: task.escalationNote,
    };
    if (task.type === "SECOND_CHECK" && task.parentTaskId) {
      const parent = await db.reviewTask.findUniqueOrThrow({ where: { id: task.parentTaskId } });
      return { ...base, firstDecision: { decision: parent.decision, reasonCode: parent.reasonCode, note: parent.note }, subject: await details(parent) };
    }
    const student = task.studentId
      ? await db.studentProfile.findUnique({ where: { id: task.studentId }, select: { id: true, name: true, rollNo: true, branch: true, batch: true, status: true } })
      : null;
    if (!student) return base;
    const [checking, previous, documents] = await Promise.all([
      task.type === "ACADEMIC_UPDATE"
        ? db.academicRecord.findUnique({ where: { id: task.subjectId } })
        : db.academicRecord.findFirst({ where: { studentId: student.id, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
      db.academicRecord.findFirst({ where: { studentId: student.id, status: "VERIFIED" }, orderBy: { createdAt: "desc" } }),
      docsFor(student.id),
    ]);
    return { ...base, student, academics: checking, previousVerified: previous, documents };
  }

  async function mustHold(userId: string, taskId: string, kind: Reviewer["kind"]) {
    const task = await db.reviewTask.findUnique({ where: { id: taskId } });
    if (!task) throw new ApiError(404, "NOT_FOUND", "Task not found.");
    const mine = task.claimedById === userId && task.status === "CLAIMED" && !!task.claimedUntil && task.claimedUntil > new Date();
    if (!mine && !(kind === "TPO" && task.status === "ESCALATED")) {
      throw new ApiError(409, "NOT_YOUR_TASK", "This task isn't locked to you any more. Take the next task again.");
    }
    return task;
  }

  /** Applies a final decision to the student/marks and closes the task. Returns emails to send after commit. */
  async function finalize(tx: Tx, task: ReviewTask, decision: Decision, reasonCode: string | null, note: string | null, actorId: string): Promise<Email[]> {
    const now = new Date();
    const emails: Email[] = [];
    if (!task.studentId) throw new ApiError(500, "BAD_TASK", "Task has no student.");
    const student = await tx.studentProfile.findUniqueOrThrow({ where: { id: task.studentId } });
    const link = `${env.WEB_APP_URL}/student/profile`;

    if (task.type === "STUDENT_VERIFICATION") {
      const draft = await tx.academicRecord.findFirst({ where: { studentId: student.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
      if (decision === "APPROVE") {
        if (!draft) throw new ApiError(409, "NO_MARKS", "The student's marks are missing; reject with 'A document is missing'.");
        await tx.academicRecord.updateMany({ where: { studentId: student.id, status: "VERIFIED" }, data: { status: "SUPERSEDED" } });
        await tx.academicRecord.update({ where: { id: draft.id }, data: { status: "VERIFIED", verifiedById: actorId, verifiedAt: now } });
        await tx.studentProfile.update({
          where: { id: student.id },
          data: {
            status: "VERIFIED",
            verifiedAt: now,
            rejectionReason: null,
            cgpa: draft.cgpa,
            activeBacklogs: draft.activeBacklogs,
            totalBacklogs: draft.totalBacklogs,
            tenthPercent: draft.tenthPercent,
            twelfthPercent: draft.twelfthPercent,
            diplomaPercent: draft.diplomaPercent,
          },
        });
        await tx.studentDocument.updateMany({ where: { studentId: student.id, status: { not: "SUPERSEDED" } }, data: { status: "ACCEPTED" } });
        emails.push(
          await notifyInApp(tx, {
            userId: student.userId,
            channel: "GENERAL",
            title: "Your Cyrus profile is verified",
            body: `Your marks and documents were checked and approved. You can now be picked for placement drives.\n\n${link}`,
            link: "/student",
          }),
        );
        await emit(tx, "student.verified", { studentId: student.id });
      } else {
        const text = reasonText(reasonCode, note);
        await tx.studentProfile.update({ where: { id: student.id }, data: { status: "REJECTED", rejectionReason: text } });
        emails.push(
          await notifyInApp(tx, {
            userId: student.userId,
            channel: "GENERAL",
            title: "Your Cyrus profile needs changes",
            body: `${text}\n\nOpen your profile, fix this and send it again:\n${link}`,
            link: "/student/profile",
          }),
        );
        await emit(tx, "student.rejected", { studentId: student.id, reasonCode });
      }
    } else if (task.type === "ACADEMIC_UPDATE") {
      const rec = await tx.academicRecord.findUniqueOrThrow({ where: { id: task.subjectId } });
      if (decision === "APPROVE") {
        await tx.academicRecord.updateMany({ where: { studentId: student.id, status: "VERIFIED" }, data: { status: "SUPERSEDED" } });
        await tx.academicRecord.update({ where: { id: rec.id }, data: { status: "VERIFIED", verifiedById: actorId, verifiedAt: now } });
        await tx.studentProfile.update({
          where: { id: student.id },
          data: {
            cgpa: rec.cgpa,
            activeBacklogs: rec.activeBacklogs,
            totalBacklogs: rec.totalBacklogs,
            tenthPercent: rec.tenthPercent,
            twelfthPercent: rec.twelfthPercent,
            diplomaPercent: rec.diplomaPercent,
          },
        });
      } else {
        await tx.academicRecord.update({ where: { id: rec.id }, data: { status: "REJECTED", reason: reasonText(reasonCode, note) } });
      }
      emails.push(
        await notifyInApp(tx, {
          userId: student.userId,
          channel: "GENERAL",
          title: decision === "APPROVE" ? "Your marks were updated" : "Your marks change request was not approved",
          body: decision === "APPROVE" ? `Your new marks are now on your profile.\n\n${link}` : `${reasonText(reasonCode, note)}\n\n${link}`,
          link: "/student/profile",
        }),
      );
    }

    await tx.reviewTask.update({
      where: { id: task.id },
      data: { status: "CLOSED", decision, reasonCode, note, decidedById: task.decidedById ?? actorId, decidedAt: task.decidedAt ?? now, closedAt: now, claimedById: null, claimedUntil: null },
    });
    await audit(tx, {
      actorId,
      action: `review.${decision === "APPROVE" ? "approved" : "rejected"}`,
      entityType: "ReviewTask",
      entityId: task.id,
      after: { type: task.type, studentId: task.studentId, reasonCode },
      reason: note ?? undefined,
    });
    return emails;
  }

  return {
    async acceptPledge(userId: string) {
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { pledgeAcceptedAt: new Date() } });
        await audit(tx, { actorId: userId, action: "review.pledge_accepted", entityType: "User", entityId: userId });
      });
      return { pledgeAcceptedAt: new Date() };
    },

    async summary(auth: AuthContext) {
      const own = await db.studentProfile.findUnique({ where: { userId: auth.userId }, select: { id: true, branch: true, batch: true } });
      const r = reviewerFrom(auth, own);
      if (!r || !taskFilterFor(r)) throw new ApiError(403, "NOT_A_REVIEWER", "You aren't on the review team.");
      const u = await db.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { pledgeAcceptedAt: true } });
      const counts = await db.$queryRaw<{ type: string; n: bigint }[]>`
        SELECT t."type"::text AS type, count(*) AS n FROM "ReviewTask" t WHERE ${eligibleSql(r)} GROUP BY t."type"`;
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const doneToday = await db.reviewTask.count({ where: { decidedById: auth.userId, decidedAt: { gte: startOfDay } } });
      const held = await heldBy(auth.userId);
      return {
        reviewer: r.kind,
        pledgeRequired: r.kind !== "TPO" && !u.pledgeAcceptedAt,
        waiting: Object.fromEntries(counts.map((c) => [c.type, Number(c.n)])),
        waitingTotal: counts.reduce((a, c) => a + Number(c.n), 0),
        doneToday,
        current: held ? { id: held.id, type: held.type, claimedUntil: held.claimedUntil } : null,
      };
    },

    /**
     * The queue as this reviewer sees it: what they may take (in the order "Get next" would hand it out),
     * what others are checking right now, their own recent decisions, and the rules that shape their queue.
     * Read-only: nothing is claimed here.
     */
    async queue(auth: AuthContext) {
      const r = await reviewerOf(auth);
      const f = taskFilterFor(r)!;
      const ids = await db.$queryRaw<{ id: string }[]>`
        SELECT t."id" FROM "ReviewTask" t WHERE ${eligibleSql(r)}
        ORDER BY t."priority" DESC, t."createdAt" ASC LIMIT 50`;
      const order = new Map(ids.map((x, i) => [x.id, i]));
      const studentSelect = { id: true, name: true, rollNo: true, branch: true, batch: true } as const;
      const [waitingRows, inProgressRows, recentRows] = await Promise.all([
        db.reviewTask.findMany({ where: { id: { in: ids.map((x) => x.id) } } }),
        db.reviewTask.findMany({
          where: { status: "CLAIMED", claimedUntil: { gt: new Date() }, claimedById: { not: auth.userId }, type: { in: f.types as never[] } },
          orderBy: { claimedUntil: "asc" },
          take: 20,
        }),
        db.reviewTask.findMany({ where: { decidedById: auth.userId }, orderBy: { decidedAt: "desc" }, take: 8 }),
      ]);
      const studentIds = [...new Set([...waitingRows, ...inProgressRows, ...recentRows].map((t) => t.studentId).filter((x): x is string => !!x))];
      const students = new Map((await db.studentProfile.findMany({ where: { id: { in: studentIds } }, select: studentSelect })).map((s) => [s.id, s]));
      const dupes = new Set(
        (
          await db.studentDocument.findMany({
            where: { studentId: { in: studentIds }, file: { sha256: { in: (await db.fileObject.groupBy({ by: ["sha256"], _count: true, having: { sha256: { _count: { gt: 1 } } } })).map((g) => g.sha256) } } },
            select: { studentId: true },
          })
        ).map((d) => d.studentId),
      );
      const reviewers = new Map(
        (await db.user.findMany({ where: { id: { in: inProgressRows.map((t) => t.claimedById!).filter(Boolean) } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u.name ?? u.email]),
      );
      const now = Date.now();
      const minutes = (d: Date | null) => (d ? Math.max(0, Math.round((now - d.getTime()) / 60_000)) : 0);
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const [doneToday, doneWeek] = await Promise.all([
        db.reviewTask.count({ where: { decidedById: auth.userId, decidedAt: { gte: startOfDay } } }),
        db.reviewTask.count({ where: { decidedById: auth.userId, decidedAt: { gte: new Date(now - 7 * 86_400_000) } } }),
      ]);
      const waiting = waitingRows
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
        .map((t) => ({
          id: t.id,
          type: t.type,
          risk: t.risk,
          status: t.status,
          waitingMinutes: minutes(t.createdAt),
          dueAt: t.dueAt,
          student: t.studentId ? (students.get(t.studentId) ?? null) : null,
          flags: {
            escalated: t.status === "ESCALATED",
            escalationNote: r.kind === "TPO" ? t.escalationNote : null,
            duplicateFile: !!t.studentId && dupes.has(t.studentId),
            lockExpired: t.status === "CLAIMED",
          },
        }));
      return {
        reviewer: r.kind,
        rules: {
          types: f.types,
          risks: f.verificationRisks,
          branches: r.scope.branches ?? null,
          batches: r.scope.batches ?? null,
          skipsOwnClass: r.kind === "VOLUNTEER" && !!r.ownStudent,
          secondChecked: r.kind === "VOLUNTEER",
        },
        stats: { waiting: waiting.length, oldestWaitingMinutes: waiting.length ? Math.max(...waiting.map((w) => w.waitingMinutes)) : 0, doneToday, doneWeek, inProgress: inProgressRows.length },
        waiting,
        inProgress: inProgressRows.map((t) => ({
          id: t.id,
          type: t.type,
          student: t.studentId ? (students.get(t.studentId) ?? null) : null,
          // Only the TPO and staff see who is checking; volunteers see that someone is.
          reviewer: r.kind === "VOLUNTEER" ? null : (reviewers.get(t.claimedById!) ?? null),
          minutesLeft: t.claimedUntil ? Math.max(0, Math.ceil((t.claimedUntil.getTime() - now) / 60_000)) : 0,
        })),
        recent: recentRows.map((t) => ({
          id: t.id,
          type: t.type,
          decision: t.decision,
          reasonCode: t.reasonCode,
          decidedAt: t.decidedAt,
          // What happened after: the student was told, it waits for a second check, or the TPO decides
          outcome: t.status === "ESCALATED" ? "WITH_TPO" : t.status === "AWAITING_SECOND_CHECK" ? "SECOND_CHECK" : "DONE",
          student: t.studentId ? (students.get(t.studentId) ?? null) : null,
        })),
      };
    },

    /** "Get next task": the most urgent task this person may take, locked to them for 15 minutes. */
    async next(auth: AuthContext) {
      const r = await reviewerOf(auth);
      const held = await heldBy(auth.userId);
      if (held) return details(held);
      const until = new Date(Date.now() + LOCK_MS);
      const claimed = await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT t."id" FROM "ReviewTask" t
          WHERE ${eligibleSql(r)}
          ORDER BY t."priority" DESC, t."createdAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`;
        const id = rows[0]?.id;
        if (!id) return null;
        const t = await tx.reviewTask.update({ where: { id }, data: { status: "CLAIMED", claimedById: auth.userId, claimedUntil: until } });
        await audit(tx, { actorId: auth.userId, action: "review.claimed", entityType: "ReviewTask", entityId: id });
        return t;
      });
      if (!claimed) return null;
      return details(claimed);
    },

    /** Take one particular task from the list (same rules as "next": only tasks this person may do, not held by anyone). */
    async claim(auth: AuthContext, taskId: string) {
      const r = await reviewerOf(auth);
      const held = await heldBy(auth.userId);
      if (held) {
        if (held.id === taskId) return details(held);
        throw new ApiError(409, "TASK_HELD", "Finish or give back the task you have open first.");
      }
      const until = new Date(Date.now() + LOCK_MS);
      const claimed = await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT t."id" FROM "ReviewTask" t
          WHERE ${eligibleSql(r)} AND t."id" = ${taskId}::uuid
          FOR UPDATE SKIP LOCKED`;
        if (!rows[0]) return null;
        const t = await tx.reviewTask.update({ where: { id: taskId }, data: { status: "CLAIMED", claimedById: auth.userId, claimedUntil: until } });
        await audit(tx, { actorId: auth.userId, action: "review.claimed", entityType: "ReviewTask", entityId: taskId });
        return t;
      });
      if (!claimed) throw new ApiError(409, "TASK_TAKEN", "Someone else is checking this one now. Pick another or take the next task.");
      return details(claimed);
    },

    async get(auth: AuthContext, taskId: string) {
      const r = await reviewerOf(auth);
      const task = await db.reviewTask.findUnique({ where: { id: taskId } });
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task not found.");
      const mine = task.claimedById === auth.userId && task.status === "CLAIMED";
      if (!mine && r.kind !== "TPO") throw new ApiError(403, "FORBIDDEN", "This task isn't yours.");
      return details(task);
    },

    async decide(auth: AuthContext, taskId: string, input: { decision: Decision; reasonCode?: RejectReason | null; note?: string | null }) {
      const r = await reviewerOf(auth);
      const task = await mustHold(auth.userId, taskId, r.kind);
      const reasonCode = input.decision === "REJECT" ? (input.reasonCode ?? null) : null;
      const note = input.note?.trim() || null;
      if (input.decision === "REJECT" && !reasonCode) throw new ApiError(400, "REASON_REQUIRED", "Pick a reason so the student knows what to fix.");
      if (reasonCode === "OTHER" && !note) throw new ApiError(400, "NOTE_REQUIRED", "Write a short note for 'Something else'.");

      let outcome: "closed" | "sent_for_second_check" | "escalated" = "closed";
      const emails = await db.$transaction(async (tx) => {
        if (task.type === "SECOND_CHECK") {
          const parent = await tx.reviewTask.findUniqueOrThrow({ where: { id: task.parentTaskId! } });
          await tx.reviewTask.update({
            where: { id: task.id },
            data: { status: "CLOSED", decision: input.decision, reasonCode, note, decidedById: auth.userId, decidedAt: new Date(), closedAt: new Date(), claimedById: null, claimedUntil: null },
          });
          if (parent.decision === input.decision) {
            return finalize(tx, parent, parent.decision as Decision, parent.reasonCode, parent.note, auth.userId);
          }
          outcome = "escalated";
          await tx.reviewTask.update({
            where: { id: parent.id },
            data: { status: "ESCALATED", escalationNote: `Second check disagreed (${input.decision.toLowerCase()})${note ? `: ${note}` : ""}` },
          });
          await audit(tx, { actorId: auth.userId, action: "review.second_check_disagreed", entityType: "ReviewTask", entityId: parent.id });
          return [];
        }

        const decidedBefore = r.kind === "VOLUNTEER" ? await tx.reviewTask.count({ where: { decidedById: auth.userId } }) : 0;
        const second =
          task.status !== "ESCALATED" &&
          needsSecondCheck({ reviewer: r.kind, decision: input.decision, risk: task.risk, reviewerDecidedCount: decidedBefore, random: random() });
        if (second) {
          outcome = "sent_for_second_check";
          await tx.reviewTask.update({
            where: { id: task.id },
            data: { status: "AWAITING_SECOND_CHECK", decision: input.decision, reasonCode, note, decidedById: auth.userId, decidedAt: new Date(), claimedById: null, claimedUntil: null },
          });
          await tx.reviewTask.create({
            data: {
              type: "SECOND_CHECK",
              risk: task.risk,
              priority: 25,
              subjectType: "ReviewTask",
              subjectId: task.id,
              parentTaskId: task.id,
              studentId: task.studentId,
              branch: task.branch,
              batch: task.batch,
            },
          });
          await audit(tx, { actorId: auth.userId, action: "review.first_decision", entityType: "ReviewTask", entityId: task.id, after: { decision: input.decision, reasonCode } });
          return [];
        }
        return finalize(tx, { ...task, decidedById: auth.userId, decidedAt: new Date() }, input.decision, reasonCode, note, auth.userId);
      });
      await sendAfterCommit(mailer, emails);
      return { outcome };
    },

    async release(auth: AuthContext, taskId: string) {
      const r = await reviewerOf(auth);
      const task = await mustHold(auth.userId, taskId, r.kind);
      if (task.status === "ESCALATED") return { released: true };
      await db.reviewTask.update({ where: { id: task.id }, data: { status: "OPEN", claimedById: null, claimedUntil: null } });
      return { released: true };
    },

    async extend(auth: AuthContext, taskId: string) {
      const r = await reviewerOf(auth);
      const task = await mustHold(auth.userId, taskId, r.kind);
      const left = (task.claimedUntil?.getTime() ?? 0) - Date.now();
      if (left > 5 * 60_000) throw new ApiError(409, "TOO_EARLY", "You can add time in the last 5 minutes of the lock.");
      const claimedUntil = new Date(Date.now() + LOCK_MS);
      await db.reviewTask.update({ where: { id: task.id }, data: { claimedUntil } });
      return { claimedUntil };
    },

    async escalate(auth: AuthContext, taskId: string, note: string) {
      const r = await reviewerOf(auth);
      const task = await mustHold(auth.userId, taskId, r.kind);
      if (r.kind === "TPO") throw new ApiError(409, "ALREADY_TOP", "You're the TPO: decide it directly.");
      await db.$transaction(async (tx) => {
        await tx.reviewTask.update({ where: { id: task.id }, data: { status: "ESCALATED", escalationNote: note, claimedById: null, claimedUntil: null } });
        await audit(tx, { actorId: auth.userId, action: "review.escalated", entityType: "ReviewTask", entityId: task.id, reason: note });
      });
      return { escalated: true };
    },
  };
}

export type ReviewService = ReturnType<typeof createReviewService>;
