import { z } from "zod";
import { MAX_KEY_POINTS } from "@cyrus/shared";
import type { Db } from "../../lib/db.ts";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import { ApiError } from "../../http/errors.ts";
import type { AuthService } from "../auth/service.ts";
import type { InterviewsService } from "./service.ts";

const MANAGERS = { roles: ["TPO" as const, "COMPANY_HR" as const] };
const PANEL_PEOPLE = { roles: ["TPO" as const, "COMPANY_HR" as const, "INTERVIEWER" as const] };
const TPO = { roles: ["TPO" as const] };
const HR = { roles: ["COMPANY_HR" as const] };
const Id = z.object({ id: z.string().uuid() });
const panelOk = { 200: { description: "The panel's screen: current student, waiting line, finished interviews" } };
const text = (max: number) => z.string().trim().max(max).nullable().optional();

const PanelBody = z.object({
  name: z.string().trim().min(1, "Give the panel a name, e.g. Panel A.").max(60),
  location: text(120),
  memberIds: z.array(z.string().uuid()).max(10),
});

/** Interview panels, the live line and feedback (BACKEND-DESIGN.md §9.10). */
export function interviewRoutes(service: InterviewsService, auth: AuthService, db: Db): RouteDef[] {
  return [
    // ───────────── setup (HR / TPO) ─────────────
    defineRoute({
      method: "get",
      path: "/rounds/:id/panels",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "The round's panels with their line counts",
      tags: ["interviews"],
      request: { params: Id },
      responses: { 200: { description: "Panels" } },
      handler: ({ auth: me, params }) => service.listPanels(me, params.id),
    }),
    defineRoute({
      method: "get",
      path: "/rounds/:id/panel-people",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "HR and interviewers of the company, who can sit on panels",
      tags: ["interviews"],
      request: { params: Id },
      responses: { 200: { description: "People" } },
      handler: ({ auth: me, params }) => service.people(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/rounds/:id/panels",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "Add a panel (name, room, interviewers)",
      tags: ["interviews"],
      request: { params: Id, body: PanelBody },
      responses: { 200: { description: "Panels" } },
      handler: ({ auth: me, params, body }) => service.createPanel(me, params.id, body),
    }),
    defineRoute({
      method: "patch",
      path: "/panels/:id",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "Change a panel's name, room or interviewers",
      tags: ["interviews"],
      request: { params: Id, body: PanelBody.partial() },
      responses: { 200: { description: "Panels" } },
      handler: ({ auth: me, params, body }) => service.updatePanel(me, params.id, body),
    }),
    defineRoute({
      method: "delete",
      path: "/panels/:id",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "Remove a panel that hasn't called anyone yet",
      tags: ["interviews"],
      request: { params: Id },
      responses: { 200: { description: "Panels" } },
      handler: ({ auth: me, params }) => service.removePanel(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/rounds/:id/queue",
      routeClass: "BACKGROUND",
      access: MANAGERS,
      summary: "Put the round's students (those who checked in, if attendance was taken) into the panels' lines, evenly; again later adds late arrivals",
      tags: ["interviews"],
      request: { params: Id },
      responses: { 200: { description: "How many were added" } },
      handler: ({ auth: me, params }) => service.buildQueue(me, params.id),
    }),
    defineRoute({
      method: "get",
      path: "/rounds/:id/interviews",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "Each student's panel, recommendation and private notes (for the final decision)",
      tags: ["interviews"],
      request: { params: Id },
      responses: { 200: { description: "Interviews" } },
      handler: ({ auth: me, params }) => service.interviewsOf(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/queue/:id/move",
      routeClass: "HOT",
      access: MANAGERS,
      summary: "Move a waiting student to the end of another panel's line",
      tags: ["interviews"],
      request: { params: Id, body: z.object({ panelId: z.string().uuid() }) },
      responses: panelOk,
      handler: ({ auth: me, params, body }) => service.move(me, params.id, body.panelId),
    }),

    // ───────────── running a panel (interviewers, HR, TPO) ─────────────
    defineRoute({
      method: "get",
      path: "/me/panels",
      routeClass: "LIGHT",
      access: PANEL_PEOPLE,
      summary: "Panels I sit on in current rounds",
      tags: ["interviews"],
      responses: { 200: { description: "Panels" } },
      handler: ({ auth: me }) => service.myPanels(me),
    }),
    defineRoute({
      method: "get",
      path: "/panels/:id",
      routeClass: "HOT",
      access: PANEL_PEOPLE,
      summary: "A panel's screen: the student called or in the room, who's waiting, who's done",
      tags: ["interviews"],
      request: { params: Id },
      responses: panelOk,
      handler: ({ auth: me, params }) => service.panelView(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/panels/:id/call-next",
      routeClass: "HOT",
      access: PANEL_PEOPLE,
      summary: "Call the next student in this panel's line (they're told at once)",
      tags: ["interviews"],
      request: { params: Id },
      responses: panelOk,
      handler: ({ auth: me, params }) => service.callNext(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/queue/:id/start",
      routeClass: "HOT",
      access: PANEL_PEOPLE,
      summary: "The called student is in the room: start the interview",
      tags: ["interviews"],
      request: { params: Id },
      responses: panelOk,
      handler: ({ auth: me, params }) => service.startInterview(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/queue/:id/end",
      routeClass: "HOT",
      access: PANEL_PEOPLE,
      summary: "End the interview: ratings per criterion, strengths, concerns, private notes, a recommendation, and an optional remark for the student (the TPO checks it first)",
      tags: ["interviews"],
      request: {
        params: Id,
        body: z.object({
          privateNotes: text(4000),
          recommendation: z.enum(["SELECT", "REJECT", "HOLD"]).nullable().optional(),
          feedback: text(1000),
          /** criterion key → 1..5 (keys from INTERVIEW_CRITERIA for the round's kind) */
          ratings: z.record(z.string().max(40), z.number().int().min(1, "Ratings are 1 to 5.").max(5, "Ratings are 1 to 5.")).nullable().optional(),
          strengths: z.array(z.string().trim().max(200)).max(MAX_KEY_POINTS).optional(),
          concerns: z.array(z.string().trim().max(200)).max(MAX_KEY_POINTS).optional(),
        }),
      },
      responses: panelOk,
      handler: ({ auth: me, params, body }) => service.endInterview(me, params.id, body),
    }),
    defineRoute({
      method: "post",
      path: "/queue/:id/skip",
      routeClass: "HOT",
      access: PANEL_PEOPLE,
      summary: "Not there when called: to the end of the line (twice = absent from the line); they're told",
      tags: ["interviews"],
      request: { params: Id },
      responses: panelOk,
      handler: ({ auth: me, params }) => service.skip(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/queue/:id/requeue",
      routeClass: "HOT",
      access: PANEL_PEOPLE,
      summary: "A student marked absent from the line turned up: back to the end of the line",
      tags: ["interviews"],
      request: { params: Id },
      responses: panelOk,
      handler: ({ auth: me, params }) => service.requeue(me, params.id),
    }),

    // ───────────── feedback (TPO) ─────────────
    defineRoute({
      method: "get",
      path: "/drives/:id/feedback",
      routeClass: "LIGHT",
      access: TPO,
      summary: "Remarks panels wrote for students in this drive, waiting for the TPO's check first",
      tags: ["interviews"],
      request: { params: Id },
      responses: { 200: { description: "Feedback" } },
      handler: ({ auth: me, params }) => service.feedbackForDrive(me, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/admin/feedback/:id",
      routeClass: "LIGHT",
      access: TPO,
      summary: "Release a remark to the student (optionally reworded) or withhold it",
      tags: ["interviews"],
      request: { params: Id, body: z.object({ action: z.enum(["RELEASE", "WITHHOLD"]), text: z.string().trim().min(1).max(1000).nullable().optional() }) },
      responses: { 200: { description: "Feedback for the drive" } },
      handler: ({ auth: me, params, body }) => service.reviewFeedback(me, params.id, body),
    }),

    // ───────────── company team: HR invites interviewers ─────────────
    defineRoute({
      method: "get",
      path: "/company/team",
      routeClass: "LIGHT",
      access: HR,
      summary: "My company's HR and interviewers, and pending interviewer invites",
      tags: ["companies"],
      responses: { 200: { description: "Team" } },
      handler: async ({ auth: me }) => {
        const mine = await db.companyMember.findFirst({ where: { userId: me.userId, role: "HR", active: true }, select: { companyId: true, company: { select: { name: true } } } });
        if (!mine) throw new ApiError(404, "NO_COMPANY", "Your account isn't linked to a company.");
        const members = await db.companyMember.findMany({ where: { companyId: mine.companyId, active: true }, select: { role: true, user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "asc" } });
        const invites = await db.invite.findMany({
          where: { companyId: mine.companyId, status: "SENT", expiresAt: { gt: new Date() } },
          select: { id: true, email: true, role: true, expiresAt: true },
          orderBy: { createdAt: "desc" },
        });
        return { company: mine.company.name, members: members.map((m) => ({ ...m.user, role: m.role })), invites };
      },
    }),
    defineRoute({
      method: "post",
      path: "/company/team",
      routeClass: "BACKGROUND",
      access: HR,
      summary: "Invite an interviewer from my company by email",
      tags: ["companies"],
      request: { body: z.object({ email: z.string().trim().email("Enter a valid email address.") }) },
      responses: { 201: { description: "Invite sent" } },
      handler: async ({ auth: me, body, res }) => {
        const mine = await db.companyMember.findFirst({ where: { userId: me.userId, role: "HR", active: true }, select: { companyId: true } });
        if (!mine) throw new ApiError(404, "NO_COMPANY", "Your account isn't linked to a company.");
        const existing = await db.companyMember.findFirst({ where: { companyId: mine.companyId, user: { email: body.email.toLowerCase() } } });
        if (existing) throw new ApiError(409, "ALREADY_MEMBER", "This person is already on your team.");
        const { inviteId } = await auth.createInvite({ email: body.email, role: "INTERVIEWER", invitedById: me.userId, companyId: mine.companyId });
        res.status(201);
        return { inviteId };
      },
    }),
  ];
}
