import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.ts";
import type { Db } from "../../lib/db.ts";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import { ApiError } from "../../http/errors.ts";

/** The TPO and placement staff see every student; volunteers only see the profiles they are checking. */
const OFFICE = { roles: ["TPO" as const, "STAFF" as const] };
const STATUSES = ["PROFILE_INCOMPLETE", "PENDING_VERIFICATION", "VERIFIED", "REJECTED"] as const;
const PAGE = 50;

/** "CSE,IT" → ["CSE", "IT"]; empty → undefined. */
const list = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : undefined));

const ListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  branch: list,
  batch: list.transform((v) => v?.map(Number).filter((n) => Number.isInteger(n))),
  status: z.enum(STATUSES).optional(),
  placed: z.enum(["yes", "no"]).optional(),
  minCgpa: z.coerce.number().min(0).max(10).optional(),
  maxBacklogs: z.coerce.number().int().min(0).max(50).optional(),
  sort: z.enum(["name", "roll", "cgpa", "recent"]).default("name"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** Every student for the placement office: filters, counts per profile state, and one student's whole record. */
export function adminStudentRoutes(db: Db): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/admin/students",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "All students, filtered (branch, batch, status, placement, CGPA, backlogs, search), with counts per status",
      tags: ["students"],
      request: { query: ListQuery },
      responses: { 200: { description: "Students" } },
      handler: async ({ query }) => {
        // Everything except the status filter: the status tabs show how many are in each state under the other filters.
        const base: Prisma.StudentProfileWhereInput = {
          ...(query.q
            ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { rollNo: { contains: query.q, mode: "insensitive" } }, { user: { email: { contains: query.q, mode: "insensitive" } } }] }
            : {}),
          ...(query.branch?.length ? { branch: { in: query.branch } } : {}),
          ...(query.batch?.length ? { batch: { in: query.batch } } : {}),
          ...(query.placed ? { placementStatus: query.placed === "yes" ? "PLACED" : "NOT_PLACED" } : {}),
          ...(query.minCgpa !== undefined ? { cgpa: { gte: query.minCgpa } } : {}),
          ...(query.maxBacklogs !== undefined ? { activeBacklogs: { lte: query.maxBacklogs } } : {}),
        };
        const where: Prisma.StudentProfileWhereInput = { ...base, ...(query.status ? { status: query.status } : {}) };
        const orderBy: Prisma.StudentProfileOrderByWithRelationInput[] =
          query.sort === "cgpa" ? [{ cgpa: { sort: "desc", nulls: "last" } }, { name: "asc" }] : query.sort === "roll" ? [{ rollNo: "asc" }] : query.sort === "recent" ? [{ createdAt: "desc" }] : [{ name: "asc" }];

        const [byStatus, placed, total, rows, branches, batches] = await Promise.all([
          db.studentProfile.groupBy({ by: ["status"], where: base, _count: true }),
          db.studentProfile.count({ where: { ...base, placementStatus: "PLACED" } }),
          db.studentProfile.count({ where }),
          db.studentProfile.findMany({
            where,
            orderBy,
            skip: (query.page - 1) * PAGE,
            take: PAGE,
            select: {
              id: true,
              name: true,
              rollNo: true,
              branch: true,
              batch: true,
              status: true,
              placementStatus: true,
              cgpa: true,
              activeBacklogs: true,
              tenthPercent: true,
              twelfthPercent: true,
              diplomaPercent: true,
              createdAt: true,
              user: { select: { email: true } },
              participations: { select: { status: true } },
            },
          }),
          db.studentProfile.findMany({ distinct: ["branch"], select: { branch: true }, orderBy: { branch: "asc" } }),
          db.studentProfile.findMany({ distinct: ["batch"], select: { batch: true }, orderBy: { batch: "asc" } }),
        ]);
        const counts = Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count ?? 0])) as Record<(typeof STATUSES)[number], number>;
        return {
          total,
          page: query.page,
          pageSize: PAGE,
          counts: { all: Object.values(counts).reduce((a, b) => a + b, 0), ...counts, placed },
          branches: branches.map((b) => b.branch),
          batches: batches.map((b) => b.batch),
          students: rows.map(({ user, participations, ...s }) => ({
            ...s,
            email: user.email,
            drives: {
              invited: participations.length,
              joined: participations.filter((p) => !["INVITED", "OPTED_OUT", "EXPIRED", "REMOVED"].includes(p.status)).length,
              selected: participations.filter((p) => ["SELECTED", "OFFERED", "PLACED"].includes(p.status)).length,
            },
          })),
        };
      },
    }),

    defineRoute({
      method: "get",
      path: "/admin/students/:id",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "One student's whole record: profile, verified marks, documents, drives and offers",
      tags: ["students"],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: { description: "Student" } },
      handler: async ({ params }) => {
        const s = await db.studentProfile.findUnique({
          where: { id: params.id },
          include: {
            user: { select: { email: true, phone: true, createdAt: true } },
            documents: { orderBy: [{ type: "asc" }, { semester: "asc" }], include: { file: { select: { id: true, originalName: true, scanStatus: true, sizeBytes: true } } } },
            academicRecords: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 1 },
            participations: {
              orderBy: { invitedAt: "desc" },
              include: {
                drive: { select: { id: true, roleTitle: true, status: true, jobType: true, ctcLpa: true, stipendMonthly: true, company: { select: { name: true } } } },
                offer: { select: { status: true, ctcLpa: true, respondBy: true } },
              },
            },
          },
        });
        if (!s) throw new ApiError(404, "NOT_FOUND", "Student not found.");
        const { user, documents, academicRecords, participations, ...profile } = s;
        return {
          profile: { ...profile, email: user.email, phone: user.phone, joinedAt: user.createdAt },
          pendingUpdate: academicRecords[0] ?? null,
          documents: documents.map((d) => ({ id: d.id, type: d.type, semester: d.semester, status: d.status, file: d.file })),
          drives: participations.map((p) => ({
            id: p.id,
            driveId: p.drive.id,
            roleTitle: p.drive.roleTitle,
            company: p.drive.company.name,
            driveStatus: p.drive.status,
            jobType: p.drive.jobType,
            ctcLpa: p.drive.ctcLpa,
            stipendMonthly: p.drive.stipendMonthly,
            status: p.status,
            invitedAt: p.invitedAt,
            respondedAt: p.respondedAt,
            offer: p.offer,
          })),
        };
      },
    }),
  ];
}
