import type { Db } from "../../lib/db.ts";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";

const OFFICE = { roles: ["TPO" as const, "STAFF" as const] };

/**
 * The placement office's overview: counts only, no student details. One call fills the page.
 * Students by profile state and placement, drives by state, the review queue, offers, feedback
 * waiting for the TPO, drives waiting for approval and the next rounds.
 */
export function overviewRoutes(db: Db): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/admin/overview",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Today's numbers for the placement office (counts only)",
      tags: ["overview"],
      responses: { 200: { description: "Overview" } },
      handler: async () => {
        const now = new Date();
        const [students, placed, drives, tasks, escalated, oldestOpen, offers, feedback, pending, rounds, companies] = await Promise.all([
          db.studentProfile.groupBy({ by: ["status"], _count: true }),
          db.studentProfile.count({ where: { placementStatus: "PLACED" } }),
          db.drive.groupBy({ by: ["status"], _count: true }),
          db.reviewTask.groupBy({ by: ["type"], where: { status: { in: ["OPEN", "REOPENED", "AWAITING_SECOND_CHECK"] } }, _count: true }),
          db.reviewTask.count({ where: { status: "ESCALATED" } }),
          db.reviewTask.findFirst({ where: { status: { in: ["OPEN", "REOPENED", "AWAITING_SECOND_CHECK"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
          db.offer.groupBy({ by: ["status"], _count: true }),
          db.feedback.count({ where: { status: "PENDING_REVIEW" } }),
          db.drive.findMany({
            where: { status: "PENDING_APPROVAL" },
            orderBy: { updatedAt: "asc" },
            take: 5,
            select: { id: true, roleTitle: true, updatedAt: true, company: { select: { name: true } } },
          }),
          db.round.findMany({
            where: { startsAt: { gte: now }, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, drive: { status: { in: ["PUBLISHED", "ONGOING"] } } },
            orderBy: { startsAt: "asc" },
            take: 5,
            select: { id: true, title: true, startsAt: true, mode: true, venue: true, drive: { select: { id: true, roleTitle: true, company: { select: { name: true } } } } },
          }),
          db.company.count(),
        ]);
        const by = <T extends { _count: number }>(rows: T[], key: (r: T) => string): Record<string, number> => Object.fromEntries(rows.map((r) => [key(r), r._count]));
        const studentBy = by(students, (r) => r.status);
        const total = Object.values(studentBy).reduce((a, b) => a + b, 0);
        return {
          students: {
            total,
            incomplete: studentBy.PROFILE_INCOMPLETE ?? 0,
            pending: studentBy.PENDING_VERIFICATION ?? 0,
            verified: studentBy.VERIFIED ?? 0,
            rejected: studentBy.REJECTED ?? 0,
            placed,
          },
          drives: by(drives, (r) => r.status),
          companies,
          review: {
            waiting: tasks.reduce((a, t) => a + t._count, 0),
            byType: by(tasks, (r) => r.type),
            escalated,
            oldestWaitingMinutes: oldestOpen ? Math.max(0, Math.round((now.getTime() - oldestOpen.createdAt.getTime()) / 60_000)) : 0,
          },
          offers: by(offers, (r) => r.status),
          feedbackToCheck: feedback,
          pendingDrives: pending.map((d) => ({ id: d.id, roleTitle: d.roleTitle, company: d.company.name, waitingSince: d.updatedAt })),
          upcomingRounds: rounds.map((r) => ({
            id: r.id,
            title: r.title,
            startsAt: r.startsAt,
            where: r.mode === "ONLINE" ? "Online" : (r.venue ?? null),
            driveId: r.drive.id,
            roleTitle: r.drive.roleTitle,
            company: r.drive.company.name,
          })),
        };
      },
    }),
  ];
}
