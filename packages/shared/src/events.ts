/**
 * Domain events (BACKEND-DESIGN.md §10). Written to the outbox table in the same
 * transaction as the change, then fanned out to queues by the relay.
 * The same names form the public webhook catalogue.
 */
export const EVENT_TYPES = [
  "company.request_submitted",
  "company.approved",
  "company.rejected",
  "company.frozen",
  "invite.sent",
  "student.submitted",
  "student.verified",
  "student.rejected",
  "import.completed",
  "task.created",
  "task.decided",
  "drive.submitted",
  "drive.published",
  "drive.updated",
  "drive.invited",
  "participation.opted_in",
  "participation.opted_out",
  "round.scheduled",
  "round.updated",
  "attendance.marked",
  "round.results_published",
  "queue.updated",
  "queue.your_turn_soon",
  "queue.called",
  "interview.started",
  "interview.ended",
  "feedback.released",
  "drive.final_results_published",
  "offer.uploaded",
  "offer.accepted",
  "offer.declined",
  "drive.closed",
  "announcement.created",
  "job.progress",
  "job.done",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface DomainEvent<T = unknown> {
  id: string;
  type: EventType;
  version: 1;
  createdAt: string;
  data: T;
}
