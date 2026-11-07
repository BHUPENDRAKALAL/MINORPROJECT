import type { Role } from "@cyrus/shared";

/** Branches a student can pick at sign-up. Keep this the only list. */
export const BRANCHES = [
  { value: "CSE", label: "Computer Science (CSE)" },
  { value: "IT", label: "Information Technology (IT)" },
  { value: "ECE", label: "Electronics & Communication (ECE)" },
  { value: "EE", label: "Electrical (EE)" },
  { value: "ME", label: "Mechanical (ME)" },
  { value: "CE", label: "Civil (CE)" },
  { value: "CHE", label: "Chemical (CHE)" },
  { value: "Other", label: "Other" },
] as const;

/** Graduation years the API accepts. */
export const BATCH_MIN = 2020;
export const BATCH_MAX = 2040;

export const ROLE_LABELS: Record<Role, string> = {
  TPO: "Training & Placement Officer",
  STAFF: "Placement staff",
  VOLUNTEER: "Volunteer",
  COORDINATOR: "Drive coordinator",
  COMPANY_HR: "Company HR",
  INTERVIEWER: "Interviewer",
  STUDENT: "Student",
  PLACED_SENIOR: "Placed senior",
};

/** Which role a person with several roles lands on first. */
export const ROLE_PRIORITY: Role[] = ["TPO", "STAFF", "VOLUNTEER", "COMPANY_HR", "INTERVIEWER", "COORDINATOR", "STUDENT", "PLACED_SENIOR"];

export const PASSWORD_HINT = "At least 8 characters, and not only numbers.";

/** Same rule as the API, so people see it before sending. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (/^\d+$/.test(pw)) return "Use letters or symbols too, not only numbers.";
  return null;
}
