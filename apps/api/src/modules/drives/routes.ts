import { z } from "zod";
import { DRIVE_STATUSES, JOB_TYPES, MAX_ROUNDS, ROUND_TYPES } from "@cyrus/shared";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import type { DrivesService } from "./service.ts";

const OFFICE = { roles: ["TPO" as const, "COMPANY_HR" as const] };
const TPO = { roles: ["TPO" as const] };
const STUDENT = { roles: ["STUDENT" as const] };

const Id = z.object({ id: z.string().uuid() });
const ok = { 200: { description: "The drive as the office / HR sees it" } };

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));

const Eligibility = z
  .object({
    branches: z.array(z.string().trim().min(1)).max(30).optional(),
    batches: z.array(z.coerce.number().int().min(2000).max(2100)).max(10).optional(),
    minCgpa: z.coerce.number().min(0).max(10, "CGPA is out of 10.").nullable().optional(),
    maxActiveBacklogs: z.coerce.number().int().min(0).max(60).nullable().optional(),
    minTenth: z.coerce.number().min(0).max(100, "Percentage is out of 100.").nullable().optional(),
    minTwelfth: z.coerce.number().min(0).max(100, "Percentage is out of 100.").nullable().optional(),
  })
  .strict()
  // Drop empty filters so the saved JSON stays small and "no filter" is obvious.
  .transform((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))));

const DriveFields = z.object({
  roleTitle: z.string().trim().min(2, "Enter the role.").max(100),
  description: z.string().trim().max(8000),
  jobType: z.enum(JOB_TYPES),
  ctcLpa: z.coerce.number().min(0).max(500).nullable(),
  stipendMonthly: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  location: optionalText(120),
  bondMonths: z.coerce.number().int().min(0).max(120).nullable(),
  optInDeadline: z.coerce.date().nullable(),
  eligibility: Eligibility,
});

const Round = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(ROUND_TYPES),
  title: z.string().trim().min(1, "Give the round a name.").max(80),
  mode: z.enum(["OFFLINE", "ONLINE"]),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  venue: optionalText(200),
  onlineLink: z.string().trim().url("Enter a full link starting with https://").max(500).nullable().optional().or(z.literal("").transform(() => null)),
  instructions: optionalText(2000),
});

/** Drives, rounds, approval and invitations (BACKEND-DESIGN.md §9.6). */
export function driveRoutes(service: DrivesService): RouteDef[] {
  return [
    // ───────────── HR and TPO ─────────────
    defineRoute({
      method: "get",
      path: "/drives",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Drives I manage (HR: my company's; TPO: all)",
      tags: ["drives"],
      request: { query: z.object({ status: z.enum(DRIVE_STATUSES).optional() }) },
      responses: { 200: { description: "Drives" } },
      handler: ({ auth, query }) => service.list(auth, query.status),
    }),
    defineRoute({
      method: "post",
      path: "/drives",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Create a draft drive",
      tags: ["drives"],
      request: { body: DriveFields.partial().extend({ roleTitle: DriveFields.shape.roleTitle, companyId: z.string().uuid().optional() }) },
      responses: { 201: { description: "Created" } },
      handler: async ({ auth, body, res }) => {
        res.status(201);
        return service.create(auth, body);
      },
    }),
    defineRoute({
      method: "get",
      path: "/drives/:id",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "A drive with its rounds, counts and what I can do with it",
      tags: ["drives"],
      request: { params: Id },
      responses: ok,
      handler: ({ auth, params }) => service.get(auth, params.id),
    }),
    defineRoute({
      method: "patch",
      path: "/drives/:id",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Edit a drive (after approval HR can change only the description, location and deadline; students are told)",
      tags: ["drives"],
      request: { params: Id, body: DriveFields.partial().strict() },
      responses: ok,
      handler: ({ auth, params, body }) => service.update(auth, params.id, body),
    }),
    defineRoute({
      method: "delete",
      path: "/drives/:id",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Delete a draft",
      tags: ["drives"],
      request: { params: Id },
      responses: { 204: { description: "Deleted" } },
      handler: async ({ auth, params, res }) => {
        await service.remove(auth, params.id);
        res.status(204).end();
      },
    }),
    defineRoute({
      method: "put",
      path: "/drives/:id/rounds",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Save the drive's rounds, in order (add, edit, reorder, remove in one go)",
      tags: ["drives"],
      request: { params: Id, body: z.object({ rounds: z.array(Round).max(MAX_ROUNDS, `A drive can have at most ${MAX_ROUNDS} rounds.`) }) },
      responses: ok,
      handler: ({ auth, params, body }) => service.saveRounds(auth, params.id, body.rounds),
    }),
    defineRoute({
      method: "post",
      path: "/drives/:id/submit",
      routeClass: "BACKGROUND",
      access: OFFICE,
      summary: "Send the drive for TPO approval (the TPO's own drive is published straight away)",
      tags: ["drives"],
      request: { params: Id },
      responses: ok,
      handler: ({ auth, params }) => service.submit(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/drives/:id/withdraw",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Take a drive back from approval to edit it",
      tags: ["drives"],
      request: { params: Id },
      responses: ok,
      handler: ({ auth, params }) => service.withdraw(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/drives/:id/eligibility/preview",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Who matches these filters (or the saved ones): count and a short list",
      tags: ["drives"],
      request: { params: Id, body: z.object({ eligibility: Eligibility.optional() }) },
      responses: { 200: { description: "Matching students" } },
      handler: ({ auth, params, body }) => service.preview(auth, params.id, body.eligibility),
    }),
    defineRoute({
      method: "post",
      path: "/drives/:id/invitations",
      routeClass: "BACKGROUND",
      access: OFFICE,
      summary: "Invite eligible students (all of them, or picked ones); each is notified",
      tags: ["drives"],
      request: {
        params: Id,
        body: z
          .object({ all: z.boolean().optional(), studentIds: z.array(z.string().uuid()).max(2000).optional() })
          .refine((b) => b.all || b.studentIds?.length, "Pick students to invite."),
      },
      responses: { 200: { description: "How many were invited" } },
      handler: ({ auth, params, body }) => service.invite(auth, params.id, body),
    }),
    defineRoute({
      method: "get",
      path: "/drives/:id/participants",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Invited students and their answers",
      tags: ["drives"],
      request: { params: Id },
      responses: { 200: { description: "Participants" } },
      handler: ({ auth, params }) => service.participants(auth, params.id),
    }),
    defineRoute({
      method: "delete",
      path: "/drives/:id/invitations/:studentId",
      routeClass: "LIGHT",
      access: OFFICE,
      summary: "Take back an invite the student hasn't answered yet",
      tags: ["drives"],
      request: { params: z.object({ id: z.string().uuid(), studentId: z.string().uuid() }) },
      responses: { 204: { description: "Removed" } },
      handler: async ({ auth, params, res }) => {
        await service.uninvite(auth, params.id, params.studentId);
        res.status(204).end();
      },
    }),

    // ───────────── TPO only ─────────────
    defineRoute({
      method: "post",
      path: "/admin/drives/:id/approve",
      routeClass: "BACKGROUND",
      access: TPO,
      summary: "Approve a drive: it opens and HR can invite students",
      tags: ["drives"],
      request: { params: Id },
      responses: ok,
      handler: ({ auth, params }) => service.decide(auth, params.id, true),
    }),
    defineRoute({
      method: "post",
      path: "/admin/drives/:id/reject",
      routeClass: "BACKGROUND",
      access: TPO,
      summary: "Send a drive back to HR with a reason",
      tags: ["drives"],
      request: { params: Id, body: z.object({ reason: z.string().trim().min(5, "Tell HR what to change.").max(1000) }) },
      responses: ok,
      handler: ({ auth, params, body }) => service.decide(auth, params.id, false, body.reason),
    }),
    defineRoute({
      method: "post",
      path: "/admin/drives/:id/cancel",
      routeClass: "BACKGROUND",
      access: TPO,
      summary: "Cancel a drive; invited students and HR are told",
      tags: ["drives"],
      request: { params: Id, body: z.object({ reason: z.string().trim().min(5, "Give a short reason; students will see it.").max(1000) }) },
      responses: ok,
      handler: ({ auth, params, body }) => service.cancel(auth, params.id, body.reason),
    }),
    defineRoute({
      method: "get",
      path: "/admin/companies",
      routeClass: "LIGHT",
      access: TPO,
      summary: "Companies (for picking one when the TPO creates a drive)",
      tags: ["companies"],
      responses: { 200: { description: "Companies" } },
      handler: () => service.companies(),
    }),
    defineRoute({
      method: "post",
      path: "/admin/companies",
      routeClass: "LIGHT",
      access: TPO,
      summary: "Add a company by hand (one that doesn't use the Company Portal)",
      tags: ["companies"],
      request: {
        body: z.object({
          name: z.string().trim().min(2, "Enter the company name.").max(120),
          website: z.string().trim().url("Enter a full link starting with https://").max(200).nullable().optional().or(z.literal("").transform(() => null)),
          industry: optionalText(80),
        }),
      },
      responses: { 201: { description: "Added" } },
      handler: async ({ auth, body, res }) => {
        res.status(201);
        return service.addCompany(auth, body);
      },
    }),

    // ───────────── students ─────────────
    defineRoute({
      method: "get",
      path: "/me/drives",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Drives I'm in (full), and other running drives (name and role only)",
      tags: ["drives"],
      responses: { 200: { description: "Drives" } },
      handler: ({ auth }) => service.myDrives(auth.userId),
    }),
    defineRoute({
      method: "get",
      path: "/me/drives/:id",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "A drive: everything if I'm invited, only the name and role if not",
      tags: ["drives"],
      request: { params: Id },
      responses: { 200: { description: "Drive" } },
      handler: ({ auth, params }) => service.myDrive(auth.userId, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/me/drives/:id/opt-in",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Join a drive I'm invited to (agrees to share my profile and resume with the company)",
      tags: ["drives"],
      request: { params: Id, body: z.object({ consent: z.literal(true, { error: "Tick the box to agree to share your profile with the company." }) }) },
      responses: { 200: { description: "Drive" } },
      handler: ({ auth, params }) => service.respond(auth.userId, params.id, true),
    }),
    defineRoute({
      method: "post",
      path: "/me/drives/:id/opt-out",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Skip a drive (can change my mind until the deadline)",
      tags: ["drives"],
      request: { params: Id },
      responses: { 200: { description: "Drive" } },
      handler: ({ auth, params }) => service.respond(auth.userId, params.id, false),
    }),
  ];
}
