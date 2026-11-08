import type { Capability, Role } from "@cyrus/shared";
import type { AuthContext } from "../../http/auth-context.ts";

/**
 * Who may take which review task (BACKEND-DESIGN.md §4b). Pure functions, easy to test.
 *
 *  TPO        every task, including escalations
 *  STAFF      student verification (any risk) with verify.first or verify.final,
 *             second checks and marks change requests with verify.final
 *  VOLUNTEER  low/medium-risk student verification only, with verify.first
 */
export type ReviewerKind = "TPO" | "STAFF" | "VOLUNTEER";

export interface Reviewer {
  userId: string;
  kind: ReviewerKind;
  capabilities: Capability[];
  /** From the role grant: limits which branches/batches this person reviews. */
  scope: { branches?: string[]; batches?: number[] };
  /** If the reviewer is also a student (volunteers usually are). */
  ownStudent: { id: string; branch: string; batch: number } | null;
}

export interface TaskFilter {
  types: string[];
  /** Only these risks for STUDENT_VERIFICATION; null = any. */
  verificationRisks: string[] | null;
  includeEscalated: boolean;
}

export function reviewerFrom(auth: AuthContext, ownStudent: Reviewer["ownStudent"]): Reviewer | null {
  const pick = (role: Role) => auth.grants.find((g) => g.role === role);
  const tpo = pick("TPO");
  const staff = pick("STAFF");
  const volunteer = pick("VOLUNTEER");
  const grant = tpo ?? staff ?? volunteer;
  if (!grant) return null;
  const kind: ReviewerKind = tpo ? "TPO" : staff ? "STAFF" : "VOLUNTEER";
  const raw = (grant.scope ?? {}) as { branches?: unknown; batches?: unknown };
  return {
    userId: auth.userId,
    kind,
    capabilities: grant.capabilities,
    scope: {
      branches: Array.isArray(raw.branches) ? raw.branches.map(String) : undefined,
      batches: Array.isArray(raw.batches) ? raw.batches.map(Number) : undefined,
    },
    ownStudent,
  };
}

export function taskFilterFor(r: Reviewer): TaskFilter | null {
  if (r.kind === "TPO") {
    return { types: ["STUDENT_VERIFICATION", "SECOND_CHECK", "ACADEMIC_UPDATE", "DUPLICATE_DOCUMENT"], verificationRisks: null, includeEscalated: true };
  }
  const first = r.capabilities.includes("verify.first");
  const final = r.capabilities.includes("verify.final");
  if (r.kind === "STAFF") {
    if (!first && !final) return null;
    const types = ["STUDENT_VERIFICATION"];
    if (final) types.push("SECOND_CHECK", "ACADEMIC_UPDATE", "DUPLICATE_DOCUMENT");
    return { types, verificationRisks: null, includeEscalated: false };
  }
  if (!first) return null;
  return { types: ["STUDENT_VERIFICATION"], verificationRisks: ["LOW", "MEDIUM"], includeEscalated: false };
}

/** Volunteers' approvals are checked again: all of their first 20, then 1 in 10. Their rejections always are. */
export const VOLUNTEER_FULL_CHECK_COUNT = 20;
export const VOLUNTEER_SPOT_CHECK_RATE = 0.1;

export function needsSecondCheck(args: {
  reviewer: ReviewerKind;
  decision: "APPROVE" | "REJECT";
  risk: string;
  reviewerDecidedCount: number;
  random: number;
}): boolean {
  const { reviewer, decision, risk, reviewerDecidedCount, random } = args;
  if (reviewer === "TPO") return false;
  if (risk === "HIGH" && reviewer !== "STAFF") return true;
  if (reviewer === "STAFF") return risk === "HIGH" && decision === "APPROVE";
  // volunteer
  if (decision === "REJECT") return true;
  if (reviewerDecidedCount < VOLUNTEER_FULL_CHECK_COUNT) return true;
  return random < VOLUNTEER_SPOT_CHECK_RATE;
}
