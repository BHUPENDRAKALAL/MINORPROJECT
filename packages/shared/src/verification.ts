/** Student verification vocabulary, shared by the API and the web app (BACKEND-DESIGN.md §4, §4b). */

export const STUDENT_STATUSES = ["PROFILE_INCOMPLETE", "PENDING_VERIFICATION", "VERIFIED", "REJECTED"] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const DOCUMENT_TYPES = ["MARKSHEET_10", "MARKSHEET_12", "DIPLOMA", "SEMESTER_MARKSHEET", "OTHER"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  MARKSHEET_10: "Class 10 marksheet",
  MARKSHEET_12: "Class 12 marksheet",
  DIPLOMA: "Diploma marksheet",
  SEMESTER_MARKSHEET: "Semester marksheet",
  OTHER: "Other document",
};

/** Standard reasons a reviewer picks when rejecting. The student sees the label and the hint. */
export const REJECT_REASONS = {
  MARKSHEET_UNCLEAR: { label: "A marksheet is hard to read", hint: "Upload a clearer scan or the original PDF." },
  VALUES_DONT_MATCH: { label: "Marks don't match the marksheet", hint: "Check your CGPA, backlogs and percentages against the documents." },
  WRONG_DOCUMENT: { label: "Wrong document uploaded", hint: "Upload the document named in the list, for the right semester." },
  MISSING_DOCUMENT: { label: "A document is missing", hint: "Upload every required marksheet." },
  DUPLICATE_DOCUMENT: { label: "This document belongs to someone else", hint: "Upload your own marksheets. Contact the placement cell if this is a mistake." },
  OTHER: { label: "Something else", hint: "Read the reviewer's note below." },
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;

export const TASK_TYPES = [
  "STUDENT_VERIFICATION",
  "ACADEMIC_UPDATE",
  "IMPORT_MISMATCH",
  "DUPLICATE_DOCUMENT",
  "COMPANY_REVIEW",
  "COMPANY_REPORT",
  "SECOND_CHECK",
  "FEEDBACK_REVIEW",
  "RESULT_CONCERN",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** How long a claimed task stays locked to its reviewer. */
export const TASK_LOCK_MINUTES = 15;
