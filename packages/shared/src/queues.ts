/**
 * Background job queues (BACKEND-DESIGN.md §2b).
 * Ordered from most to least urgent. Each queue gets its own worker processes,
 * so slow work (OCR, exports) can never delay urgent work (notifications).
 */
export const QUEUES = {
  notify: { name: "notify", concurrency: 20, description: "Push, email and in-app notifications" },
  webhooks: { name: "webhooks", concurrency: 10, description: "Deliveries to outside teams' servers" },
  imports: { name: "imports", concurrency: 2, description: "Official sheet import and matching, results sheets" },
  documents: { name: "documents", concurrency: 1, description: "Virus scan, PDF reading, OCR hints" },
  companyChecks: { name: "company-checks", concurrency: 2, description: "Domain, DNS, RDAP and website checks" },
  reports: { name: "reports", concurrency: 1, description: "Exports, stats, drive archiving" },
} as const;

export type QueueKey = keyof typeof QUEUES;
export type QueueName = (typeof QUEUES)[QueueKey]["name"];

/** Job lifecycle stored in the jobs table and shown to users (GET /jobs/:id). */
export const JOB_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
