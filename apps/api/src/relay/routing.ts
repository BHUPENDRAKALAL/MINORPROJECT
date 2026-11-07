import type { EventType, QueueKey } from "@placesync/shared";

/**
 * Which queues an event goes to after it is committed (BACKEND-DESIGN.md §2).
 * Every event also goes to `webhooks`, which checks the subscriptions itself.
 * Events not listed here go to `webhooks` only.
 */
const ROUTES: Partial<Record<EventType, QueueKey[]>> = {
  "company.request_submitted": ["companyChecks", "notify"],
  "company.approved": ["notify"],
  "company.rejected": ["notify"],
  "invite.sent": ["notify"],
  "student.verified": ["notify"],
  "student.rejected": ["notify"],
  "drive.submitted": ["notify"],
  "drive.updated": ["notify"],
  "drive.invited": ["notify"],
  "round.scheduled": ["notify"],
  "round.updated": ["notify"],
  "round.results_published": ["notify"],
  "queue.your_turn_soon": ["notify"],
  "queue.called": ["notify"],
  "feedback.released": ["notify"],
  "drive.final_results_published": ["notify"],
  "offer.uploaded": ["notify", "documents"],
  "offer.accepted": ["notify", "reports"],
  "offer.declined": ["notify"],
  "drive.closed": ["reports"],
  "announcement.created": ["notify"],
};

/** Internal-only events that must never leave the system through webhooks. */
const INTERNAL_ONLY = new Set<EventType>(["job.progress", "job.done", "task.created", "task.decided"]);

export function queuesFor(type: EventType): QueueKey[] {
  const targets = new Set<QueueKey>(ROUTES[type] ?? []);
  if (!INTERNAL_ONLY.has(type)) targets.add("webhooks");
  return [...targets];
}
