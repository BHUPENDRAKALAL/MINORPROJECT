import { z } from "zod";
import type { Db } from "../../lib/db.ts";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import { ApiError } from "../../http/errors.ts";
import type { AuthService } from "../auth/service.ts";
import { audit } from "../../lib/audit.ts";

const TPO = { roles: ["TPO" as const] };
const REVIEW_CAPS = ["verify.first", "verify.final", "import.resolve", "update_request.decide", "drive.attendance", "drive.queue"] as const;

/** The TPO's review team: staff and student volunteers (BACKEND-DESIGN.md §4b). */
export function teamRoutes(db: Db, auth: AuthService): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/admin/team",
      routeClass: "LIGHT",
      access: TPO,
      summary: "Staff and volunteers, with their permissions and scope, plus pending invites",
      tags: ["team"],
      responses: { 200: { description: "Team" } },
      handler: async () => {
        const grants = await db.roleGrant.findMany({
          where: { role: { in: ["STAFF", "VOLUNTEER"] } },
          include: { user: { select: { id: true, email: true, name: true, status: true, pledgeAcceptedAt: true } } },
          orderBy: { createdAt: "asc" },
        });
        const invites = await db.invite.findMany({
          where: { role: { in: ["STAFF", "VOLUNTEER"] }, status: "SENT", expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true, capabilities: true, scope: true, expiresAt: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
        const decided = await db.reviewTask.groupBy({ by: ["decidedById"], where: { decidedById: { in: grants.map((g) => g.userId) } }, _count: true });
        const count = new Map(decided.map((d) => [d.decidedById, d._count]));
        return {
          members: grants.map((g) => ({
            userId: g.user.id,
            email: g.user.email,
            name: g.user.name,
            role: g.role,
            capabilities: g.capabilities,
            scope: g.scope,
            expiresAt: g.expiresAt,
            status: g.user.status,
            pledgeAccepted: !!g.user.pledgeAcceptedAt,
            tasksDecided: count.get(g.user.id) ?? 0,
          })),
          invites,
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/team",
      routeClass: "BACKGROUND",
      access: TPO,
      summary: "Invite a staff member or volunteer by email",
      tags: ["team"],
      request: {
        body: z.object({
          email: z.string().trim().email("Enter a valid email address."),
          role: z.enum(["STAFF", "VOLUNTEER"]),
          capabilities: z.array(z.enum(REVIEW_CAPS)).min(1, "Give at least one permission."),
          scope: z
            .object({ branches: z.array(z.string().trim().min(1)).optional(), batches: z.array(z.coerce.number().int()).optional() })
            .optional(),
        }),
      },
      responses: { 201: { description: "Invite sent" } },
      handler: async ({ auth: me, body, res }) => {
        if (body.role === "VOLUNTEER" && body.capabilities.includes("verify.final")) {
          throw new ApiError(400, "NOT_FOR_VOLUNTEERS", "Volunteers can do first checks only. Give final checks to staff.");
        }
        const { inviteId } = await auth.createInvite({
          email: body.email,
          role: body.role,
          invitedById: me.userId,
          capabilities: body.capabilities,
          scope: body.scope ?? {},
        });
        res.status(201);
        return { inviteId };
      },
    }),
    defineRoute({
      method: "delete",
      path: "/admin/team/:userId/:role",
      routeClass: "LIGHT",
      access: TPO,
      summary: "Remove someone's staff or volunteer access (their account stays)",
      tags: ["team"],
      request: { params: z.object({ userId: z.string().uuid(), role: z.enum(["STAFF", "VOLUNTEER"]) }) },
      responses: { 204: { description: "Removed" } },
      handler: async ({ auth: me, params, res }) => {
        await db.$transaction(async (tx) => {
          const removed = await tx.roleGrant.deleteMany({ where: { userId: params.userId, role: params.role } });
          if (!removed.count) throw new ApiError(404, "NOT_FOUND", "That person doesn't have this access.");
          // Anything they were holding goes back to the queue.
          await tx.reviewTask.updateMany({ where: { claimedById: params.userId, status: "CLAIMED" }, data: { status: "OPEN", claimedById: null, claimedUntil: null } });
          await audit(tx, { actorId: me.userId, action: "team.member_removed", entityType: "User", entityId: params.userId, after: { role: params.role } });
        });
        res.status(204).end();
      },
    }),
  ];
}
