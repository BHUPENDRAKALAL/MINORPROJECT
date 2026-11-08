import { z } from "zod";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import type { RoundsService } from "./service.ts";

const MANAGERS = { roles: ["TPO" as const, "COMPANY_HR" as const] };
/** Running a round's check-in: managers plus review-team members given drive-day attendance. */
const DAY_HELPERS = { roles: ["TPO" as const, "COMPANY_HR" as const], capabilities: ["drive.attendance" as const], match: "any" as const };
const STUDENT = { roles: ["STUDENT" as const] };
const Id = z.object({ id: z.string().uuid() });
const Sid = z.object({ sid: z.string().uuid() });
const ok = { 200: { description: "The round with its students, attendance and results" } };
const Result = z.enum(["SELECTED", "REJECTED", "ON_HOLD", "PENDING"]);
const coord = (max: number) => z.coerce.number().min(-max).max(max).nullable().optional();

/** Running rounds: start, attendance and results (BACKEND-DESIGN.md §9.8, §9.9). */
export function roundRoutes(service: RoundsService): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/rounds/:id",
      routeClass: "LIGHT",
      access: DAY_HELPERS,
      summary: "A round: its students, who checked in, results and what can be done now",
      tags: ["rounds"],
      request: { params: Id },
      responses: ok,
      handler: ({ auth, params }) => service.view(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/rounds/:id/start",
      routeClass: "BACKGROUND",
      access: MANAGERS,
      summary: "Start a round (the first one also closes joining); students in the drive are told",
      tags: ["rounds"],
      request: { params: Id },
      responses: ok,
      handler: ({ auth, params }) => service.start(auth, params.id),
    }),
    defineRoute({
      method: "put",
      path: "/rounds/:id/results",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "Save results for some or all students (not shown to students until published)",
      tags: ["rounds"],
      request: { params: Id, body: z.object({ results: z.array(z.object({ participationId: z.string().uuid(), result: Result })).min(1).max(3000) }) },
      responses: ok,
      handler: ({ auth, params, body }) => service.setResults(auth, params.id, body.results),
    }),
    defineRoute({
      method: "post",
      path: "/rounds/:id/results/import",
      routeClass: "HEAVY",
      access: MANAGERS,
      summary: "Results from a test platform's CSV: a roll-number column and a result column",
      tags: ["rounds"],
      limit: { windowMs: 60_000, max: 20 },
      request: { params: Id, body: z.object({ csv: z.string().min(1, "The file is empty.").max(900_000, "The file is too big (max ~900 KB).") }) },
      responses: { 200: { description: "How many rows were imported, and the rows that didn't match" } },
      handler: ({ auth, params, body }) => service.importResults(auth, params.id, body.csv),
    }),
    defineRoute({
      method: "post",
      path: "/rounds/:id/results/publish",
      routeClass: "BACKGROUND",
      access: MANAGERS,
      summary: "Publish: rejected and absent students leave the drive, selected go on; everyone is told",
      tags: ["rounds"],
      request: { params: Id },
      responses: ok,
      handler: ({ auth, params }) => service.publish(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/rounds/:id/attendance/sessions",
      routeClass: "LIGHT",
      access: DAY_HELPERS,
      summary: "Open check-in for an on-campus round (optionally at the venue's location and radius)",
      tags: ["attendance"],
      request: { params: Id, body: z.object({ lat: coord(90), lng: coord(180), radiusM: z.coerce.number().int().min(20).max(2000).nullable().optional() }) },
      responses: { 200: { description: "The check-in session" } },
      handler: ({ auth, params, body }) => service.openSession(auth, params.id, body),
    }),
    defineRoute({
      method: "get",
      path: "/attendance/sessions/:sid/qr",
      routeClass: "HOT",
      access: DAY_HELPERS,
      summary: "The current QR value for the venue screen (changes every few seconds) and how many have checked in",
      tags: ["attendance"],
      request: { params: Sid },
      responses: { 200: { description: "QR" } },
      handler: ({ auth, params }) => service.qr(auth, params.sid),
    }),
    defineRoute({
      method: "post",
      path: "/attendance/sessions/:sid/close",
      routeClass: "LIGHT",
      access: DAY_HELPERS,
      summary: "Close check-in",
      tags: ["attendance"],
      request: { params: Sid },
      responses: ok,
      handler: ({ auth, params }) => service.closeSession(auth, params.sid),
    }),
    defineRoute({
      method: "post",
      path: "/attendance/check-in",
      routeClass: "HOT",
      access: STUDENT,
      summary: "Check in with the QR value from the venue screen (and my location when the venue asks for it)",
      tags: ["attendance"],
      limit: { windowMs: 60_000, max: 30 },
      request: { body: z.object({ token: z.string().min(10).max(200), lat: coord(90), lng: coord(180) }) },
      responses: { 200: { description: "Checked in" } },
      handler: ({ auth, body }) => service.checkIn(auth.userId, body),
    }),
    defineRoute({
      method: "post",
      path: "/rounds/:id/attendance/manual",
      routeClass: "LIGHT",
      access: { roles: ["TPO"], capabilities: ["drive.attendance"], match: "any" },
      summary: "Mark a student present or absent by hand, with a reason (kept in the audit log)",
      tags: ["attendance"],
      request: {
        params: Id,
        body: z.object({ participationId: z.string().uuid(), present: z.boolean(), reason: z.string().trim().min(3, "Give a short reason.").max(300) }),
      },
      responses: ok,
      handler: ({ auth, params, body }) => service.markManual(auth, params.id, body),
    }),
  ];
}
