import { z } from "zod";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import type { OffersService } from "./service.ts";

const MANAGERS = { roles: ["TPO" as const, "COMPANY_HR" as const] };
const STUDENT = { roles: ["STUDENT" as const] };
const Id = z.object({ id: z.string().uuid() });
const listOk = { 200: { description: "Selected students and their offers" } };

/** Offer letters and closing a drive (BACKEND-DESIGN.md §9.11). */
export function offerRoutes(service: OffersService): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/drives/:id/offers",
      routeClass: "LIGHT",
      access: MANAGERS,
      summary: "Selected students and the state of each offer",
      tags: ["offers"],
      request: { params: Id },
      responses: listOk,
      handler: ({ auth, params }) => service.list(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/drives/:id/offers",
      routeClass: "BACKGROUND",
      access: MANAGERS,
      summary: "Send (or replace) a selected student's offer letter (upload the PDF first with kind=OFFER_LETTER)",
      tags: ["offers"],
      request: {
        params: Id,
        body: z.object({
          participationId: z.string().uuid(),
          fileId: z.string().uuid(),
          ctcLpa: z.coerce.number().min(0).max(500).nullable().optional(),
          joiningDate: z.coerce.date().nullable().optional(),
          respondBy: z.coerce.date().nullable().optional(),
        }),
      },
      responses: listOk,
      handler: ({ auth, params, body }) => service.send(auth, params.id, body),
    }),
    defineRoute({
      method: "post",
      path: "/offers/:id/revoke",
      routeClass: "BACKGROUND",
      access: MANAGERS,
      summary: "Withdraw an offer the student hasn't answered (with a reason the student sees)",
      tags: ["offers"],
      request: { params: Id, body: z.object({ reason: z.string().trim().min(5, "Give a short reason; the student will see it.").max(500) }) },
      responses: listOk,
      handler: ({ auth, params, body }) => service.revoke(auth, params.id, body.reason),
    }),
    defineRoute({
      method: "get",
      path: "/offers/:id/letter",
      routeClass: "LIGHT",
      access: "authenticated",
      summary: "A 2-minute link to the offer letter (only the student, the TPO and the company's HR)",
      tags: ["offers"],
      request: { params: Id },
      responses: { 200: { description: "Link" } },
      handler: ({ auth, params }) => service.letter(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/me/offers/:id/accept",
      routeClass: "BACKGROUND",
      access: STUDENT,
      summary: "Accept my offer: I'm placed, and the placement is recorded",
      tags: ["offers"],
      request: { params: Id },
      responses: { 200: { description: "Accepted" } },
      handler: ({ auth, params }) => service.respond(auth.userId, params.id, true),
    }),
    defineRoute({
      method: "post",
      path: "/me/offers/:id/decline",
      routeClass: "BACKGROUND",
      access: STUDENT,
      summary: "Decline my offer",
      tags: ["offers"],
      request: { params: Id },
      responses: { 200: { description: "Declined" } },
      handler: ({ auth, params }) => service.respond(auth.userId, params.id, false),
    }),
    defineRoute({
      method: "post",
      path: "/admin/drives/:id/close",
      routeClass: "BACKGROUND",
      access: { roles: ["TPO"] },
      summary: "Close a drive after its final results (HR becomes read-only; history kept)",
      tags: ["drives"],
      request: { params: Id },
      responses: { 200: { description: "Closed" } },
      handler: ({ auth, params }) => service.close(auth, params.id),
    }),
  ];
}
