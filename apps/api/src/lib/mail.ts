import type { Queues } from "./queues.ts";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** How the API hands an email off. Production: a job on the `notify` queue. Tests: an in-memory list. */
export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Queue-backed mailer. The job is removed from Redis as soon as it is sent,
 * because emails can carry one-time codes.
 */
export function queueMailer(queues: Queues): Mailer {
  return {
    async send(message) {
      await queues.notify.add(
        "email.send",
        { type: "email.send", data: { ...message } },
        { removeOnComplete: true, removeOnFail: { age: 3600 }, attempts: 5 },
      );
    },
  };
}

/** Collects emails in memory (tests and scripts). */
export function memoryMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
