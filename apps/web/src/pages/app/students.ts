import type { Tone } from "../../components/kit";
import type { StudentStatus } from "../../lib/api";

/** How each profile state reads and which dot colour it gets, in the placement office's student pages. */
export const STUDENT_STATUS: Record<StudentStatus, { label: string; tone: Tone }> = {
  VERIFIED: { label: "Verified", tone: "success" },
  PENDING_VERIFICATION: { label: "Being checked", tone: "info" },
  REJECTED: { label: "Needs changes", tone: "warning" },
  PROFILE_INCOMPLETE: { label: "Not sent yet", tone: "neutral" },
};
