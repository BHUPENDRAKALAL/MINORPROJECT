import { z } from "zod";
import { DOCUMENT_TYPES } from "@cyrus/shared";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import type { StudentsService } from "./service.ts";

const STUDENT = { roles: ["STUDENT" as const] };

const Academic = z.object({
  cgpa: z.coerce.number().min(0, "CGPA can't be negative.").max(10, "CGPA is out of 10."),
  activeBacklogs: z.coerce.number().int().min(0).max(60),
  totalBacklogs: z.coerce.number().int().min(0).max(60),
  tenthPercent: z.coerce.number().min(0).max(100, "Percentage is out of 100."),
  twelfthPercent: z.coerce.number().min(0).max(100, "Percentage is out of 100.").nullable().optional(),
  diplomaPercent: z.coerce.number().min(0).max(100, "Percentage is out of 100.").nullable().optional(),
  semester: z.coerce.number().int().min(1).max(10).nullable().optional().describe("Latest semester these marks cover"),
});

const Patch = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ]{10,15}$/, "Enter a valid phone number.")
      .nullable()
      .optional(),
    gender: z.string().trim().max(30).nullable().optional(),
    degree: z.string().trim().max(60).nullable().optional(),
    skills: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    links: z.array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().url().max(300) })).max(5).optional(),
    resumeFileId: z.string().uuid().nullable().optional(),
    photoFileId: z.string().uuid().nullable().optional(),
    hideInAnnouncements: z.boolean().optional().describe("Leave my name out of placement announcements"),
  })
  .strict();

export function studentRoutes(service: StudentsService): RouteDef[] {
  const ok = { 200: { description: "The student's profile, marks, documents and review state" } };
  return [
    defineRoute({
      method: "get",
      path: "/students/me",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "My profile, marks draft, documents, what's missing and the review state",
      tags: ["students"],
      responses: ok,
      handler: ({ auth }) => service.getMine(auth.userId),
    }),
    defineRoute({
      method: "patch",
      path: "/students/me",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Edit personal details, skills, links, resume and photo (always allowed)",
      tags: ["students"],
      request: { body: Patch },
      responses: ok,
      handler: ({ auth, body }) => service.updateMine(auth.userId, body),
    }),
    defineRoute({
      method: "put",
      path: "/students/me/academics",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Save marks as a draft (only before submitting, or after a rejection)",
      tags: ["students"],
      request: { body: Academic },
      responses: ok,
      handler: ({ auth, body }) => service.saveAcademics(auth.userId, body),
    }),
    defineRoute({
      method: "post",
      path: "/students/me/documents",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Attach an uploaded marksheet (POST /files?kind=MARKSHEET first)",
      tags: ["students"],
      request: {
        body: z.object({
          fileId: z.string().uuid(),
          type: z.enum(DOCUMENT_TYPES),
          semester: z.coerce.number().int().min(1).max(10).nullable().optional(),
        }),
      },
      responses: ok,
      handler: ({ auth, body }) => service.addDocument(auth.userId, body),
    }),
    defineRoute({
      method: "delete",
      path: "/students/me/documents/:id",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Remove a document (before submitting)",
      tags: ["students"],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: ok,
      handler: ({ auth, params }) => service.removeDocument(auth.userId, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/students/me/submit",
      routeClass: "BACKGROUND",
      access: STUDENT,
      summary: "Send the profile for verification (creates a review task)",
      tags: ["students"],
      limit: { windowMs: 60 * 60_000, max: 20 },
      responses: { ...ok, 400: { description: "Something is missing (details.missing lists it)" } },
      handler: ({ auth }) => service.submit(auth.userId),
    }),
    defineRoute({
      method: "post",
      path: "/students/me/withdraw",
      routeClass: "LIGHT",
      access: STUDENT,
      summary: "Take the submission back while no reviewer is working on it",
      tags: ["students"],
      responses: { ...ok, 409: { description: "A reviewer is already checking it" } },
      handler: ({ auth }) => service.withdraw(auth.userId),
    }),
    defineRoute({
      method: "post",
      path: "/students/me/update-requests",
      routeClass: "BACKGROUND",
      access: STUDENT,
      summary: "After verification: ask to change marks (reviewed by staff)",
      tags: ["students"],
      request: { body: Academic.extend({ note: z.string().trim().max(300).optional() }) },
      responses: ok,
      handler: ({ auth, body }) => {
        const { note, ...academics } = body;
        return service.requestAcademicUpdate(auth.userId, academics, note);
      },
    }),
  ];
}
