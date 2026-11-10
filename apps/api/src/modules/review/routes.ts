import { z } from "zod";
import { REJECT_REASONS } from "@cyrus/shared";
import { defineRoute, type RouteDef } from "../../http/define-route.ts";
import type { ReviewService } from "./service.ts";

const REVIEW_TEAM = { roles: ["TPO" as const, "STAFF" as const, "VOLUNTEER" as const] };
const TaskId = z.object({ id: z.string().uuid() });
const reasonKeys = Object.keys(REJECT_REASONS) as [keyof typeof REJECT_REASONS, ...(keyof typeof REJECT_REASONS)[]];

export function reviewRoutes(service: ReviewService): RouteDef[] {
  return [
    defineRoute({
      method: "post",
      path: "/work/onboarding/pledge",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "Accept the confidentiality pledge (needed once before reviewing)",
      tags: ["review"],
      responses: { 200: { description: "Accepted" } },
      handler: ({ auth }) => service.acceptPledge(auth.userId),
    }),
    defineRoute({
      method: "get",
      path: "/work/summary",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "What's waiting for me, what I hold, what I did today",
      tags: ["review"],
      responses: { 200: { description: "Summary" } },
      handler: ({ auth }) => service.summary(auth),
    }),
    defineRoute({
      method: "get",
      path: "/work/queue",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "The tasks I may take, in the order Get next hands them out; what others are checking; my recent decisions",
      tags: ["review"],
      responses: { 200: { description: "Queue" } },
      handler: ({ auth }) => service.queue(auth),
    }),
    defineRoute({
      method: "post",
      path: "/work/next",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "Take the next task I'm allowed to do (locked to me for 15 minutes). null = nothing waiting.",
      tags: ["review"],
      responses: { 200: { description: "The task with everything needed to decide, or null" } },
      handler: async ({ auth }) => (await service.next(auth)) ?? { task: null },
    }),
    defineRoute({
      method: "get",
      path: "/work/tasks/:id",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "A task I hold (or any task, for the TPO)",
      tags: ["review"],
      request: { params: TaskId },
      responses: { 200: { description: "Task details" } },
      handler: ({ auth, params }) => service.get(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/work/tasks/:id/decision",
      routeClass: "BACKGROUND",
      access: REVIEW_TEAM,
      summary: "Verify or reject. May go to a second check first; the student is notified when final.",
      tags: ["review"],
      request: {
        params: TaskId,
        body: z.object({
          decision: z.enum(["APPROVE", "REJECT"]),
          reasonCode: z.enum(reasonKeys).nullable().optional(),
          note: z.string().trim().max(500).nullable().optional(),
        }),
      },
      responses: { 200: { description: "closed | sent_for_second_check | escalated" } },
      handler: ({ auth, params, body }) => service.decide(auth, params.id, body),
    }),
    defineRoute({
      method: "post",
      path: "/work/tasks/:id/claim",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "Take this task from the list (locked to me for 15 minutes), if I may do it and no one else has it",
      tags: ["review"],
      request: { params: TaskId },
      responses: { 200: { description: "The task with everything needed to decide" } },
      handler: ({ auth, params }) => service.claim(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/work/tasks/:id/release",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "Give the task back to the queue",
      tags: ["review"],
      request: { params: TaskId },
      responses: { 200: { description: "Released" } },
      handler: ({ auth, params }) => service.release(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/work/tasks/:id/extend",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "Add 15 more minutes (in the last 5 minutes of the lock)",
      tags: ["review"],
      request: { params: TaskId },
      responses: { 200: { description: "New lock end" } },
      handler: ({ auth, params }) => service.extend(auth, params.id),
    }),
    defineRoute({
      method: "post",
      path: "/work/tasks/:id/escalate",
      routeClass: "LIGHT",
      access: REVIEW_TEAM,
      summary: "Not sure? Send it up to the TPO with a question",
      tags: ["review"],
      request: { params: TaskId, body: z.object({ note: z.string().trim().min(5, "Say what you're unsure about.").max(500) }) },
      responses: { 200: { description: "Escalated" } },
      handler: ({ auth, params, body }) => service.escalate(auth, params.id, body.note),
    }),
  ];
}
