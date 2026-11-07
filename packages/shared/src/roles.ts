/** Account roles (PLAN.md §2, BACKEND-DESIGN.md §4b). One user can hold several roles. */
export const ROLES = [
  "TPO",
  "STAFF",
  "VOLUNTEER",
  "COORDINATOR",
  "COMPANY_HR",
  "INTERVIEWER",
  "STUDENT",
  "PLACED_SENIOR",
] as const;
export type Role = (typeof ROLES)[number];

/** Fine-grained permissions given to review-team members by the TPO (BACKEND-DESIGN.md §4b). */
export const CAPABILITIES = [
  "verify.first",
  "verify.final",
  "import.resolve",
  "update_request.decide",
  "drive.attendance",
  "drive.queue",
  "feedback.review",
  "team.manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
