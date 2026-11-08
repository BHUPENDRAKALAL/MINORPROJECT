import {
  EDITABLE_DRIVE_STATUSES,
  OPEN_DRIVE_STATUSES,
  VISIBLE_DRIVE_STATUSES,
  type DriveStatus,
  type Eligibility,
  type JobType,
  type RoundType,
} from "@cyrus/shared";
import type { Db } from "../../lib/db.ts";
import type { Mailer } from "../../lib/mail.ts";
import type { Env } from "../../config/env.ts";
import type { AuthContext } from "../../http/auth-context.ts";
import { ApiError } from "../../http/errors.ts";
import { audit } from "../../lib/audit.ts";
import { emit } from "../../lib/outbox.ts";
import { notifyInApp, sendAfterCommit } from "../../lib/notify.ts";
import type { Prisma } from "../../generated/prisma/client.ts";

type Tx = Prisma.TransactionClient;

export interface DrivesDeps {
  db: Db;
  mailer: Mailer;
  env: Env;
  /** The student's place in interview lines (from the interviews module). */
  myOffer?: (participationId: string) => Promise<unknown>;
  myLine?: (participationId: string) => Promise<{ roundId: string; panel: string; location: string | null; status: string; position: number | null; waitMinutes: number | null }[]>;
}

export interface DriveInput {
  companyId?: string;
  roleTitle?: string;
  description?: string;
  jobType?: JobType;
  ctcLpa?: number | null;
  stipendMonthly?: number | null;
  location?: string | null;
  bondMonths?: number | null;
  optInDeadline?: Date | null;
  eligibility?: Eligibility;
}

export interface RoundInput {
  id?: string;
  type: RoundType;
  title: string;
  mode: "OFFLINE" | "ONLINE";
  startsAt?: Date | null;
  endsAt?: Date | null;
  venue?: string | null;
  onlineLink?: string | null;
  instructions?: string | null;
}

const is = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

/** Fields HR can no longer change once the TPO has approved the drive (the TPO still can). */
const LOCKED_AFTER_APPROVAL = ["roleTitle", "jobType", "ctcLpa", "stipendMonthly", "bondMonths", "eligibility"] as const;

/** Statuses that count as "in the drive" for a student (can see everything about it). */
const IN_DRIVE = ["INVITED", "OPTED_IN", "OPTED_OUT", "EXPIRED", "ELIMINATED", "NO_SHOW", "SELECTED", "OFFERED", "PLACED", "OFFER_DECLINED"] as const;

const roundSelect = {
  id: true,
  sequence: true,
  type: true,
  title: true,
  mode: true,
  startsAt: true,
  endsAt: true,
  venue: true,
  onlineLink: true,
  instructions: true,
  status: true,
} as const;

export function createDrivesService({ db, mailer, env, myLine, myOffer }: DrivesDeps) {
  const link = (path: string) => `${env.WEB_APP_URL}${path}`;

  // ───────────── who may touch which drive ─────────────

  /** Company ids an HR account works for. TPO: null = every company. */
  async function companiesOf(auth: AuthContext): Promise<string[] | null> {
    if (auth.has("TPO")) return null;
    const rows = await db.companyMember.findMany({ where: { userId: auth.userId, role: "HR", active: true }, select: { companyId: true } });
    return rows.map((r) => r.companyId);
  }

  /** The drive, if this person may manage it. Someone else's drive looks like it doesn't exist. */
  async function ownDrive(auth: AuthContext, id: string) {
    const drive = await db.drive.findUnique({ where: { id }, include: { company: { select: { id: true, name: true, status: true } } } });
    const companies = await companiesOf(auth);
    if (!drive || (companies && !companies.includes(drive.companyId))) throw new ApiError(404, "NOT_FOUND", "Drive not found.");
    return drive;
  }

  async function tpoIds(tx: Tx) {
    const grants = await tx.roleGrant.findMany({ where: { role: "TPO" }, select: { userId: true } });
    return grants.map((g) => g.userId);
  }

  async function policy() {
    return (await db.placementPolicy.findUnique({ where: { id: "default" } })) ?? { blockPlacedStudents: true, dreamOfferMinCtcLpa: null };
  }

  // ───────────── eligibility ─────────────

  /** Verified students who match the filters and the college's placement rules. */
  async function eligibleWhere(e: Eligibility, ctcLpa: number | null): Promise<Prisma.StudentProfileWhereInput> {
    const p = await policy();
    const and: Prisma.StudentProfileWhereInput[] = [
      { status: "VERIFIED", user: { status: "ACTIVE" } },
      { OR: [{ blockedUntil: null }, { blockedUntil: { lt: new Date() } }] },
    ];
    if (e.branches?.length) and.push({ branch: { in: e.branches } });
    if (e.batches?.length) and.push({ batch: { in: e.batches } });
    if (e.minCgpa != null) and.push({ cgpa: { gte: e.minCgpa } });
    if (e.maxActiveBacklogs != null) and.push({ activeBacklogs: { lte: e.maxActiveBacklogs } });
    if (e.minTenth != null) and.push({ tenthPercent: { gte: e.minTenth } });
    // Diploma students have no class 12 marks: their diploma percentage counts instead.
    if (e.minTwelfth != null) and.push({ OR: [{ twelfthPercent: { gte: e.minTwelfth } }, { twelfthPercent: null, diplomaPercent: { gte: e.minTwelfth } }] });
    const dream = p.dreamOfferMinCtcLpa != null && ctcLpa != null && ctcLpa >= p.dreamOfferMinCtcLpa;
    if (p.blockPlacedStudents && !dream) and.push({ placementStatus: "NOT_PLACED" });
    return { AND: and };
  }

  // ───────────── shapes sent to the web app ─────────────

  async function officeView(auth: AuthContext, id: string) {
    const drive = await ownDrive(auth, id);
    const [rounds, counts] = await Promise.all([
      db.round.findMany({ where: { driveId: id }, orderBy: { sequence: "asc" }, select: roundSelect }),
      db.participation.groupBy({ by: ["status"], where: { driveId: id }, _count: true }),
    ]);
    const count = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>;
    const tpo = auth.has("TPO");
    const status = drive.status as DriveStatus;
    return {
      id: drive.id,
      company: drive.company,
      roleTitle: drive.roleTitle,
      description: drive.description,
      jobType: drive.jobType,
      ctcLpa: drive.ctcLpa,
      stipendMonthly: drive.stipendMonthly,
      location: drive.location,
      bondMonths: drive.bondMonths,
      status,
      optInDeadline: drive.optInDeadline,
      eligibility: (drive.eligibility ?? {}) as Eligibility,
      rejectionReason: drive.rejectionReason,
      approvedAt: drive.approvedAt,
      createdAt: drive.createdAt,
      updatedAt: drive.updatedAt,
      rounds,
      /** What still has to be filled in before it can be sent (drafts only). */
      missing: is(EDITABLE_DRIVE_STATUSES, status) ? await missingForSubmit(id) : [],
      counts: {
        invited: count["INVITED"] ?? 0,
        joined: count["OPTED_IN"] ?? 0,
        skipped: count["OPTED_OUT"] ?? 0,
        total: Object.entries(count).filter(([s]) => s !== "REMOVED").reduce((a, [, n]) => a + n, 0),
      },
      can: {
        edit: is(EDITABLE_DRIVE_STATUSES, status) || (tpo && status === "PENDING_APPROVAL"),
        editLimited: is(OPEN_DRIVE_STATUSES, status),
        editRounds: is(EDITABLE_DRIVE_STATUSES, status) || is(OPEN_DRIVE_STATUSES, status) || (tpo && status === "PENDING_APPROVAL"),
        submit: is(EDITABLE_DRIVE_STATUSES, status),
        withdraw: !tpo && status === "PENDING_APPROVAL",
        decide: tpo && status === "PENDING_APPROVAL",
        invite: is(OPEN_DRIVE_STATUSES, status),
        cancel: tpo && !["CLOSED", "CANCELLED"].includes(status),
        delete: is(EDITABLE_DRIVE_STATUSES, status),
      },
    };
  }

  // ───────────── office / HR ─────────────

  async function list(auth: AuthContext, status?: DriveStatus) {
    const companies = await companiesOf(auth);
    const drives = await db.drive.findMany({
      where: {
        ...(status ? { status } : {}),
        // HR: their company's drives. TPO: everything except other people's unsent drafts.
        ...(companies ? { companyId: { in: companies } } : { NOT: { status: "DRAFT", createdById: { not: auth.userId } } }),
      },
      orderBy: [{ updatedAt: "desc" }],
      include: { company: { select: { id: true, name: true } }, _count: { select: { rounds: true } } },
    });
    const joined = await db.participation.groupBy({
      by: ["driveId", "status"],
      where: { driveId: { in: drives.map((d) => d.id) }, status: { in: ["INVITED", "OPTED_IN"] } },
      _count: true,
    });
    const n = (driveId: string, s: string) => joined.find((j) => j.driveId === driveId && j.status === s)?._count ?? 0;
    const myCompanies = companies ? await db.company.findMany({ where: { id: { in: companies } }, select: { id: true, name: true } }) : null;
    return {
      companies: myCompanies,
      drives: drives.map((d) => ({
        id: d.id,
        company: d.company,
        roleTitle: d.roleTitle,
        jobType: d.jobType,
        ctcLpa: d.ctcLpa,
        stipendMonthly: d.stipendMonthly,
        status: d.status,
        optInDeadline: d.optInDeadline,
        rounds: d._count.rounds,
        invited: n(d.id, "INVITED") + n(d.id, "OPTED_IN"),
        joined: n(d.id, "OPTED_IN"),
        updatedAt: d.updatedAt,
      })),
    };
  }

  async function create(auth: AuthContext, input: DriveInput & { roleTitle: string }) {
    const companies = await companiesOf(auth);
    let companyId = input.companyId;
    if (companies) {
      if (!companyId) companyId = companies[0];
      if (!companyId || !companies.includes(companyId)) throw new ApiError(403, "NOT_YOUR_COMPANY", "You can only create drives for your own company.");
    }
    if (!companyId) throw new ApiError(400, "VALIDATION_FAILED", "Pick the company.", { issues: [{ path: "companyId", message: "Pick the company." }] });
    const company = await db.company.findUnique({ where: { id: companyId } });
    if (!company) throw new ApiError(404, "NOT_FOUND", "Company not found.");
    if (company.status !== "APPROVED") throw new ApiError(409, "COMPANY_NOT_ACTIVE", "This company is frozen or banned, so it can't run drives.");

    const id = await db.$transaction(async (tx) => {
      const drive = await tx.drive.create({
        data: {
          companyId: companyId!,
          createdById: auth.userId,
          title: input.roleTitle,
          roleTitle: input.roleTitle,
          description: input.description ?? "",
          jobType: input.jobType ?? "FULL_TIME",
          ctcLpa: input.ctcLpa ?? null,
          stipendMonthly: input.stipendMonthly ?? null,
          location: input.location ?? null,
          bondMonths: input.bondMonths ?? null,
          optInDeadline: input.optInDeadline ?? null,
          eligibility: (input.eligibility ?? {}) as Prisma.InputJsonValue,
        },
      });
      await audit(tx, { actorId: auth.userId, action: "drive.created", entityType: "Drive", entityId: drive.id });
      return drive.id;
    });
    return officeView(auth, id);
  }

  async function update(auth: AuthContext, id: string, input: DriveInput) {
    const drive = await ownDrive(auth, id);
    const status = drive.status as DriveStatus;
    const tpo = auth.has("TPO");
    const full = is(EDITABLE_DRIVE_STATUSES, status) || (tpo && (status === "PENDING_APPROVAL" || is(OPEN_DRIVE_STATUSES, status)));
    const limited = is(OPEN_DRIVE_STATUSES, status);
    if (!full && !limited) {
      throw new ApiError(409, "DRIVE_LOCKED", status === "PENDING_APPROVAL" ? "The drive is waiting for TPO approval. Take it back to make changes." : "This drive can't be changed any more.");
    }
    if (!full) {
      const blocked = LOCKED_AFTER_APPROVAL.filter((f) => input[f] !== undefined);
      if (blocked.length) throw new ApiError(409, "LOCKED_AFTER_APPROVAL", "The role, pay, bond and eligibility were approved by the TPO. Ask the TPO to change them.", { fields: blocked });
    }
    if (input.companyId && input.companyId !== drive.companyId) throw new ApiError(400, "CANT_MOVE", "A drive can't be moved to another company.");
    if (input.optInDeadline && is(OPEN_DRIVE_STATUSES, status) && drive.optInDeadline && input.optInDeadline < drive.optInDeadline && !tpo) {
      throw new ApiError(409, "DEADLINE_EARLIER", "The joining deadline can only be moved later once students are invited.");
    }

    const emails = await db.$transaction(async (tx) => {
      await tx.drive.update({
        where: { id },
        data: {
          ...(input.roleTitle !== undefined ? { roleTitle: input.roleTitle, title: input.roleTitle } : {}),
          description: input.description,
          jobType: input.jobType,
          ctcLpa: input.ctcLpa,
          stipendMonthly: input.stipendMonthly,
          location: input.location,
          bondMonths: input.bondMonths,
          optInDeadline: input.optInDeadline,
          ...(input.eligibility !== undefined ? { eligibility: input.eligibility as Prisma.InputJsonValue } : {}),
        },
      });
      await audit(tx, { actorId: auth.userId, action: "drive.updated", entityType: "Drive", entityId: id, after: Object.keys(input) as Prisma.InputJsonValue });
      if (!is(OPEN_DRIVE_STATUSES, status)) return [];
      await emit(tx, "drive.updated", { driveId: id });
      return tellParticipants(tx, id, drive.company.name, drive.roleTitle, "Drive details changed", "Some details of this drive were updated. Open the drive to see them.");
    });
    await sendAfterCommit(mailer, emails);
    return officeView(auth, id);
  }

  async function tellParticipants(tx: Tx, driveId: string, company: string, role: string, title: string, body: string) {
    const people = await tx.participation.findMany({
      where: { driveId, status: { in: ["INVITED", "OPTED_IN"] } },
      select: { student: { select: { userId: true } } },
    });
    const out = [];
    for (const p of people) {
      out.push(await notifyInApp(tx, { userId: p.student.userId, channel: "DRIVES", title: `${company} · ${role}: ${title}`, body, link: link(`/student/drives/${driveId}`) }));
    }
    return out;
  }

  async function remove(auth: AuthContext, id: string) {
    const drive = await ownDrive(auth, id);
    if (!is(EDITABLE_DRIVE_STATUSES, drive.status)) throw new ApiError(409, "DRIVE_LOCKED", "Only a draft can be deleted. Ask the TPO to cancel a published drive.");
    await db.$transaction(async (tx) => {
      await tx.drive.delete({ where: { id } });
      await audit(tx, { actorId: auth.userId, action: "drive.deleted", entityType: "Drive", entityId: id });
    });
  }

  /**
   * Saves the whole round list at once (the builder sends it in order). Rounds with an id are updated,
   * new ones created, missing ones deleted. A round that has started can't be removed or change kind.
   */
  async function saveRounds(auth: AuthContext, id: string, rounds: RoundInput[]) {
    const drive = await ownDrive(auth, id);
    const status = drive.status as DriveStatus;
    const tpo = auth.has("TPO");
    if (!(is(EDITABLE_DRIVE_STATUSES, status) || is(OPEN_DRIVE_STATUSES, status) || (tpo && status === "PENDING_APPROVAL"))) {
      throw new ApiError(409, "DRIVE_LOCKED", status === "PENDING_APPROVAL" ? "The drive is waiting for TPO approval. Take it back to make changes." : "Rounds of this drive can't be changed any more.");
    }
    rounds.forEach((r, i) => {
      if (r.startsAt && r.endsAt && r.endsAt < r.startsAt) {
        throw new ApiError(400, "VALIDATION_FAILED", "A round can't end before it starts.", { issues: [{ path: `rounds.${i}.endsAt`, message: "Ends before it starts." }] });
      }
    });

    const existing = await db.round.findMany({ where: { driveId: id } });
    const byId = new Map(existing.map((r) => [r.id, r]));
    for (const r of rounds) if (r.id && !byId.has(r.id)) throw new ApiError(400, "UNKNOWN_ROUND", "One of the rounds no longer exists. Reload the page.");
    const kept = new Set(rounds.filter((r) => r.id).map((r) => r.id!));
    for (const old of existing) {
      const started = old.status !== "SCHEDULED";
      if (started && !kept.has(old.id)) throw new ApiError(409, "ROUND_STARTED", `"${old.title}" has already started and can't be removed.`);
      const next = rounds.find((r) => r.id === old.id);
      if (started && next && next.type !== old.type) throw new ApiError(409, "ROUND_STARTED", `"${old.title}" has already started; its kind can't change.`);
    }

    const changed = (r: RoundInput) => {
      const old = r.id ? byId.get(r.id) : undefined;
      if (!old) return true;
      return (
        old.title !== r.title ||
        old.mode !== r.mode ||
        (old.startsAt?.getTime() ?? null) !== (r.startsAt?.getTime() ?? null) ||
        (old.venue ?? null) !== (r.venue ?? null) ||
        (old.onlineLink ?? null) !== (r.onlineLink ?? null)
      );
    };
    const scheduleChanged = rounds.some(changed) || existing.length !== rounds.length || rounds.some((r, i) => r.id && byId.get(r.id)!.sequence !== i + 1);

    const emails = await db.$transaction(async (tx) => {
      await tx.round.deleteMany({ where: { driveId: id, id: { notIn: [...kept] } } });
      // Move the kept rounds out of the way first: (driveId, sequence) is unique.
      for (const r of existing.filter((x) => kept.has(x.id))) await tx.round.update({ where: { id: r.id }, data: { sequence: -r.sequence - 1000 } });
      for (const [i, r] of rounds.entries()) {
        const data = {
          sequence: i + 1,
          type: r.type,
          title: r.title,
          mode: r.mode,
          startsAt: r.startsAt ?? null,
          endsAt: r.endsAt ?? null,
          venue: r.venue ?? null,
          onlineLink: r.onlineLink ?? null,
          instructions: r.instructions ?? null,
        };
        if (r.id) await tx.round.update({ where: { id: r.id }, data });
        else await tx.round.create({ data: { ...data, driveId: id } });
      }
      await audit(tx, { actorId: auth.userId, action: "drive.rounds_saved", entityType: "Drive", entityId: id, after: { rounds: rounds.map((r) => r.title) } });
      if (!is(OPEN_DRIVE_STATUSES, status) || !scheduleChanged) return [];
      await emit(tx, "round.updated", { driveId: id });
      return tellParticipants(tx, id, drive.company.name, drive.roleTitle, "Round schedule changed", "The rounds or their dates, venue or link changed. Open the drive to see the new schedule.");
    });
    await sendAfterCommit(mailer, emails);
    return officeView(auth, id);
  }

  /** What is still missing before the TPO can look at the drive. */
  async function missingForSubmit(id: string) {
    const drive = await db.drive.findUniqueOrThrow({ where: { id }, include: { _count: { select: { rounds: true } } } });
    const missing: string[] = [];
    if (drive.description.trim().length < 20) missing.push("A job description (a few lines at least)");
    if (drive.jobType === "FULL_TIME" && drive.ctcLpa == null) missing.push("The CTC");
    if (drive.jobType !== "FULL_TIME" && drive.stipendMonthly == null) missing.push("The monthly stipend");
    if (!drive.optInDeadline) missing.push("The last date for students to join");
    else if (drive.optInDeadline < new Date()) missing.push("A joining deadline in the future");
    if (!drive._count.rounds) missing.push("At least one round");
    return missing;
  }

  async function submit(auth: AuthContext, id: string) {
    const drive = await ownDrive(auth, id);
    if (!is(EDITABLE_DRIVE_STATUSES, drive.status)) throw new ApiError(409, "BAD_STATE", "This drive has already been sent.");
    const missing = await missingForSubmit(id);
    if (missing.length) throw new ApiError(400, "INCOMPLETE", "Fill in the missing parts before sending.", { missing });
    const tpo = auth.has("TPO");
    const emails = await db.$transaction(async (tx) => {
      if (tpo) {
        // The TPO's own drive (for a company that doesn't use the app) is published straight away.
        await tx.drive.update({ where: { id }, data: { status: "PUBLISHED", approvedById: auth.userId, approvedAt: new Date(), rejectionReason: null } });
        await audit(tx, { actorId: auth.userId, action: "drive.published", entityType: "Drive", entityId: id });
        await emit(tx, "drive.published", { driveId: id });
        return [];
      }
      await tx.drive.update({ where: { id }, data: { status: "PENDING_APPROVAL", rejectionReason: null } });
      await audit(tx, { actorId: auth.userId, action: "drive.submitted", entityType: "Drive", entityId: id });
      await emit(tx, "drive.submitted", { driveId: id });
      const out = [];
      for (const userId of await tpoIds(tx)) {
        out.push(await notifyInApp(tx, { userId, channel: "DRIVES", title: `New drive to approve: ${drive.company.name} · ${drive.roleTitle}`, body: "A company sent a drive for your approval.", link: link(`/office/drives/${id}`) }));
      }
      return out;
    });
    await sendAfterCommit(mailer, emails);
    return officeView(auth, id);
  }

  async function withdraw(auth: AuthContext, id: string) {
    const drive = await ownDrive(auth, id);
    if (drive.status !== "PENDING_APPROVAL") throw new ApiError(409, "BAD_STATE", "Only a drive waiting for approval can be taken back.");
    await db.$transaction(async (tx) => {
      await tx.drive.update({ where: { id }, data: { status: "DRAFT" } });
      await audit(tx, { actorId: auth.userId, action: "drive.withdrawn", entityType: "Drive", entityId: id });
    });
    return officeView(auth, id);
  }

  async function decide(auth: AuthContext, id: string, approve: boolean, reason?: string) {
    const drive = await ownDrive(auth, id);
    if (drive.status !== "PENDING_APPROVAL") throw new ApiError(409, "BAD_STATE", "This drive isn't waiting for approval.");
    if (approve) {
      const missing = await missingForSubmit(id);
      if (missing.length) throw new ApiError(400, "INCOMPLETE", "This drive is missing some parts. Send it back with a note.", { missing });
    }
    const emails = await db.$transaction(async (tx) => {
      await tx.drive.update({
        where: { id },
        data: approve ? { status: "PUBLISHED", approvedById: auth.userId, approvedAt: new Date(), rejectionReason: null } : { status: "REJECTED", rejectionReason: reason },
      });
      await audit(tx, { actorId: auth.userId, action: approve ? "drive.approved" : "drive.rejected", entityType: "Drive", entityId: id, reason });
      if (approve) await emit(tx, "drive.published", { driveId: id });
      return [
        await notifyInApp(tx, {
          userId: drive.createdById,
          channel: "DRIVES",
          title: approve ? `Drive approved: ${drive.roleTitle}` : `Drive sent back: ${drive.roleTitle}`,
          body: approve ? "The placement office approved your drive. You can now invite eligible students." : `The placement office sent your drive back: ${reason}`,
          link: link(`/company/drives/${id}`),
        }),
      ];
    });
    await sendAfterCommit(mailer, emails);
    return officeView(auth, id);
  }

  async function cancel(auth: AuthContext, id: string, reason: string) {
    const drive = await ownDrive(auth, id);
    if (["CLOSED", "CANCELLED"].includes(drive.status)) throw new ApiError(409, "BAD_STATE", "This drive is already closed.");
    const emails = await db.$transaction(async (tx) => {
      const out = await tellParticipants(tx, id, drive.company.name, drive.roleTitle, "Drive cancelled", `This drive has been cancelled. ${reason}`);
      await tx.drive.update({ where: { id }, data: { status: "CANCELLED", rejectionReason: reason, closedAt: new Date() } });
      await audit(tx, { actorId: auth.userId, action: "drive.cancelled", entityType: "Drive", entityId: id, reason });
      await emit(tx, "drive.updated", { driveId: id });
      if (drive.createdById !== auth.userId) {
        out.push(await notifyInApp(tx, { userId: drive.createdById, channel: "DRIVES", title: `Drive cancelled: ${drive.roleTitle}`, body: reason, link: link(`/company/drives/${id}`) }));
      }
      return out;
    });
    await sendAfterCommit(mailer, emails);
    return officeView(auth, id);
  }

  // ───────────── eligibility and invitations ─────────────

  async function preview(auth: AuthContext, id: string, filters?: Eligibility) {
    const drive = await ownDrive(auth, id);
    const where = await eligibleWhere(filters ?? ((drive.eligibility ?? {}) as Eligibility), drive.ctcLpa);
    const [count, students] = await Promise.all([
      db.studentProfile.count({ where }),
      db.studentProfile.findMany({
        where,
        orderBy: [{ cgpa: "desc" }, { rollNo: "asc" }],
        take: 300,
        select: { id: true, name: true, rollNo: true, branch: true, batch: true, cgpa: true, activeBacklogs: true, participations: { where: { driveId: id }, select: { status: true } } },
      }),
    ]);
    return {
      count,
      students: students.map(({ participations, ...s }) => ({ ...s, inDrive: participations[0]?.status ?? null })),
    };
  }

  async function invite(auth: AuthContext, id: string, body: { all?: boolean; studentIds?: string[] }) {
    const drive = await ownDrive(auth, id);
    if (!is(OPEN_DRIVE_STATUSES, drive.status)) throw new ApiError(409, "BAD_STATE", "Students can be invited once the TPO has approved the drive.");
    if (!drive.optInDeadline || drive.optInDeadline < new Date()) throw new ApiError(409, "DEADLINE_PASSED", "The joining deadline has passed. Move it later to invite more students.");
    const where = await eligibleWhere((drive.eligibility ?? {}) as Eligibility, drive.ctcLpa);
    const eligible = await db.studentProfile.findMany({
      where: body.all ? where : { AND: [where, { id: { in: body.studentIds ?? [] } }] },
      select: { id: true, userId: true },
    });
    if (!body.all) {
      const outside = (body.studentIds ?? []).length - eligible.length;
      if (outside > 0) throw new ApiError(400, "NOT_ELIGIBLE", `${outside} of the picked students don't match this drive's eligibility.`);
    }
    const current = await db.participation.findMany({ where: { driveId: id, studentId: { in: eligible.map((s) => s.id) } }, select: { studentId: true, status: true } });
    const status = new Map(current.map((c) => [c.studentId, c.status]));
    const fresh = eligible.filter((s) => !status.has(s.id) || status.get(s.id) === "REMOVED");

    const emails = await db.$transaction(async (tx) => {
      const out = [];
      for (const s of fresh) {
        await tx.participation.upsert({
          where: { driveId_studentId: { driveId: id, studentId: s.id } },
          create: { driveId: id, studentId: s.id, invitedById: auth.userId },
          update: { status: "INVITED", invitedById: auth.userId, invitedAt: new Date(), respondedAt: null, consentAt: null },
        });
        out.push(
          await notifyInApp(tx, {
            userId: s.userId,
            channel: "DRIVES",
            title: `You're invited: ${drive.company.name} · ${drive.roleTitle}`,
            body: `You are eligible for this drive. Join before ${drive.optInDeadline!.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} if you want to take part.`,
            link: link(`/student/drives/${id}`),
          }),
        );
      }
      if (fresh.length) {
        await audit(tx, { actorId: auth.userId, action: "drive.invited", entityType: "Drive", entityId: id, after: { count: fresh.length } });
        await emit(tx, "drive.invited", { driveId: id, studentIds: fresh.map((s) => s.id) });
      }
      return out;
    });
    await sendAfterCommit(mailer, emails);
    return { invited: fresh.length, alreadyIn: eligible.length - fresh.length };
  }

  async function participants(auth: AuthContext, id: string) {
    await ownDrive(auth, id);
    const rows = await db.participation.findMany({
      where: { driveId: id, status: { not: "REMOVED" } },
      orderBy: [{ status: "asc" }, { invitedAt: "asc" }],
      select: {
        status: true,
        invitedAt: true,
        respondedAt: true,
        student: { select: { id: true, name: true, rollNo: true, branch: true, batch: true, cgpa: true, activeBacklogs: true } },
      },
    });
    return { participants: rows.map(({ student, ...p }) => ({ ...student, ...p })) };
  }

  async function uninvite(auth: AuthContext, id: string, studentId: string) {
    await ownDrive(auth, id);
    const p = await db.participation.findUnique({ where: { driveId_studentId: { driveId: id, studentId } } });
    if (!p || p.status === "REMOVED") throw new ApiError(404, "NOT_FOUND", "This student isn't in the drive.");
    if (p.status !== "INVITED") throw new ApiError(409, "ALREADY_RESPONDED", "This student has already answered the invite and can't be removed.");
    await db.$transaction(async (tx) => {
      await tx.participation.update({ where: { id: p.id }, data: { status: "REMOVED" } });
      await audit(tx, { actorId: auth.userId, action: "drive.uninvited", entityType: "Participation", entityId: p.id });
    });
  }

  // ───────────── companies (TPO) ─────────────

  async function companies() {
    return {
      companies: await db.company.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, website: true, industry: true, status: true, _count: { select: { drives: true, members: true } } },
      }),
    };
  }

  async function addCompany(auth: AuthContext, body: { name: string; website?: string | null; industry?: string | null }) {
    const domain = body.website ? new URL(body.website).hostname.replace(/^www\./, "") : null;
    if (domain && (await db.company.findUnique({ where: { domain } }))) throw new ApiError(409, "COMPANY_EXISTS", "A company with this website is already added.");
    return db.$transaction(async (tx) => {
      const c = await tx.company.create({ data: { name: body.name, website: body.website ?? null, industry: body.industry ?? null, domain } });
      await audit(tx, { actorId: auth.userId, action: "company.added", entityType: "Company", entityId: c.id });
      return { id: c.id, name: c.name };
    });
  }

  // ───────────── students ─────────────

  async function profileOf(userId: string) {
    const p = await db.studentProfile.findUnique({ where: { userId }, select: { id: true, status: true, blockedUntil: true } });
    if (!p) throw new ApiError(404, "NO_PROFILE", "No student profile on this account.");
    return p;
  }

  const deadlinePassed = (d: { optInDeadline: Date | null }) => !d.optInDeadline || d.optInDeadline < new Date();

  /** A student's answer state: what they can do now. */
  function myState(drive: { status: string; optInDeadline: Date | null }, status: string) {
    const open = is(OPEN_DRIVE_STATUSES, drive.status) && !deadlinePassed(drive);
    return {
      status: status === "INVITED" && is(OPEN_DRIVE_STATUSES, drive.status) && deadlinePassed(drive) ? "EXPIRED" : status,
      canJoin: open && (status === "INVITED" || status === "OPTED_OUT"),
      canSkip: open && (status === "INVITED" || status === "OPTED_IN"),
    };
  }

  /** My drives in full, and every other running drive by name only. */
  async function myDrives(userId: string) {
    const me = await profileOf(userId);
    const mine = await db.participation.findMany({
      where: { studentId: me.id, status: { in: [...IN_DRIVE] }, drive: { status: { in: [...VISIBLE_DRIVE_STATUSES, "CANCELLED"] } } },
      orderBy: { invitedAt: "desc" },
      select: {
        status: true,
        drive: {
          select: {
            id: true,
            roleTitle: true,
            jobType: true,
            ctcLpa: true,
            stipendMonthly: true,
            location: true,
            status: true,
            optInDeadline: true,
            company: { select: { name: true } },
            rounds: { orderBy: { sequence: "asc" }, select: { title: true, startsAt: true, status: true } },
          },
        },
      },
    });
    const mineIds = mine.map((m) => m.drive.id);
    const others = await db.drive.findMany({
      where: { status: { in: [...VISIBLE_DRIVE_STATUSES] }, id: { notIn: mineIds }, company: { status: "APPROVED" } },
      orderBy: { approvedAt: "desc" },
      take: 50,
      select: { id: true, roleTitle: true, jobType: true, status: true, company: { select: { name: true } } },
    });
    return {
      mine: mine.map(({ status, drive: { rounds, ...d } }) => {
        const next = rounds.find((r) => r.status === "SCHEDULED" || r.status === "IN_PROGRESS");
        return { ...d, company: d.company.name, rounds: rounds.length, nextRound: next ? { title: next.title, startsAt: next.startsAt } : null, me: myState(d, status) };
      }),
      others: others.map((d) => ({ ...d, company: d.company.name })),
    };
  }

  async function myDrive(userId: string, id: string) {
    const me = await profileOf(userId);
    const drive = await db.drive.findUnique({
      where: { id },
      include: { company: { select: { name: true, website: true, about: true, status: true } }, rounds: { orderBy: { sequence: "asc" }, select: roundSelect } },
    });
    if (!drive || !(is(VISIBLE_DRIVE_STATUSES, drive.status) || drive.status === "CANCELLED")) throw new ApiError(404, "NOT_FOUND", "Drive not found.");
    const p = await db.participation.findUnique({ where: { driveId_studentId: { driveId: id, studentId: me.id } } });
    const inDrive = !!p && is(IN_DRIVE, p.status);
    if (!inDrive) {
      if (drive.status === "CANCELLED" || drive.company.status !== "APPROVED") throw new ApiError(404, "NOT_FOUND", "Drive not found.");
      // Not invited: the student may know the drive exists, nothing more.
      return { id: drive.id, company: drive.company.name, roleTitle: drive.roleTitle, jobType: drive.jobType, status: drive.status, inDrive: false as const };
    }
    const state = myState(drive, p!.status);
    const joined = p!.status !== "INVITED" && p!.status !== "OPTED_OUT" && p!.status !== "EXPIRED";
    // My part in each round: did I check in, my result once published, and whether check-in is open now.
    const [line, notes] = joined
      ? await Promise.all([
          myLine ? myLine(p!.id) : [],
          db.feedback.findMany({ where: { participationId: p!.id, status: { in: ["RELEASED", "EDITED_AND_RELEASED"] } }, select: { roundId: true, releasedText: true } }),
        ])
      : [[], []];
    const [att, res, open] = joined
      ? await Promise.all([
          db.attendance.findMany({ where: { participationId: p!.id }, select: { roundId: true } }),
          db.roundResult.findMany({ where: { participationId: p!.id, round: { status: "RESULTS_PUBLISHED" } }, select: { roundId: true, result: true } }),
          p!.status === "OPTED_IN" ? db.attendanceSession.findMany({ where: { status: "OPEN", round: { driveId: id } }, select: { roundId: true } }) : [],
        ])
      : [[], [], []];
    const attended = new Set(att.map((a) => a.roundId));
    const resultOf = new Map(res.map((r) => [r.roundId, r.result]));
    const checkInOpen = new Set(open.map((o) => o.roundId));
    return {
      id: drive.id,
      inDrive: true as const,
      company: drive.company.name,
      companyWebsite: drive.company.website,
      companyAbout: drive.company.about,
      roleTitle: drive.roleTitle,
      description: drive.description,
      jobType: drive.jobType,
      ctcLpa: drive.ctcLpa,
      stipendMonthly: drive.stipendMonthly,
      location: drive.location,
      bondMonths: drive.bondMonths,
      status: drive.status,
      cancelReason: drive.status === "CANCELLED" ? drive.rejectionReason : null,
      optInDeadline: drive.optInDeadline,
      eligibility: (drive.eligibility ?? {}) as Eligibility,
      // Online links only for students who joined.
      rounds: drive.rounds.map((r) => ({
        ...r,
        onlineLink: joined ? r.onlineLink : null,
        my: joined
          ? {
              attended: attended.has(r.id),
              result: resultOf.get(r.id) ?? null,
              out: p!.eliminatedAtRoundId === r.id ? (p!.status === "NO_SHOW" ? "ABSENT" : "NOT_SELECTED") : null,
              checkInOpen: checkInOpen.has(r.id),
              line: line.find((l) => l.roundId === r.id) ?? null,
              feedback: notes.filter((n) => n.roundId === r.id).map((n) => n.releasedText ?? ""),
            }
          : null,
      })),
      me: { ...state, invitedAt: p!.invitedAt, respondedAt: p!.respondedAt },
      offer: joined && myOffer ? await myOffer(p!.id) : null,
    };
  }

  async function respond(userId: string, id: string, join: boolean) {
    const me = await profileOf(userId);
    const drive = await db.drive.findUnique({ where: { id }, select: { status: true, optInDeadline: true } });
    const p = drive && (await db.participation.findUnique({ where: { driveId_studentId: { driveId: id, studentId: me.id } } }));
    if (!drive || !p || !is(IN_DRIVE, p.status)) throw new ApiError(404, "NOT_FOUND", "Drive not found.");
    const state = myState(drive, p.status);
    if (join && !state.canJoin) throw new ApiError(409, deadlinePassed(drive) ? "DEADLINE_PASSED" : "BAD_STATE", deadlinePassed(drive) ? "The last date to join has passed." : "You can't join this drive now.");
    if (!join && !state.canSkip) throw new ApiError(409, deadlinePassed(drive) ? "DEADLINE_PASSED" : "BAD_STATE", deadlinePassed(drive) ? "The last date to answer has passed." : "You can't skip this drive now.");
    if (join && me.blockedUntil && me.blockedUntil > new Date()) throw new ApiError(403, "BLOCKED", "You are blocked from joining drives for now. Contact the placement office.");
    await db.$transaction(async (tx) => {
      await tx.participation.update({
        where: { id: p.id },
        data: { status: join ? "OPTED_IN" : "OPTED_OUT", respondedAt: new Date(), consentAt: join ? new Date() : null },
      });
      await audit(tx, { actorId: userId, action: join ? "participation.opted_in" : "participation.opted_out", entityType: "Participation", entityId: p.id });
      await emit(tx, join ? "participation.opted_in" : "participation.opted_out", { driveId: id, studentId: me.id });
    });
    return myDrive(userId, id);
  }

  return {
    list,
    get: officeView,
    create,
    update,
    remove,
    saveRounds,
    submit,
    withdraw,
    decide,
    cancel,
    preview,
    invite,
    participants,
    uninvite,
    companies,
    addCompany,
    myDrives,
    myDrive,
    respond,
    missingForSubmit,
  };
}

export type DrivesService = ReturnType<typeof createDrivesService>;
