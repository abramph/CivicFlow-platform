/**
 * Unestra for PTA — stable, machine-readable error codes. Every code maps to
 * a fixed HTTP status so routes never have to guess (mirrors
 * meeting-intelligence/errors.ts's pattern).
 */
export const PTA_ERROR_CODES = [
  "PTA_NOT_ENABLED",
  /** Organization.primaryVertical is not PTA — the authoritative reason core
   * PTA access is denied, since PR #40 (PTA graduated from a Labs-gated
   * pilot to a first-class vertical; see docs/pta-access-architecture.md). */
  "PTA_ORGANIZATION_NOT_PTA_VERTICAL",
  /** The organization is PTA but not currently active (suspended/cancelled). */
  "PTA_ORGANIZATION_INACTIVE",
  "PTA_PROFILE_NOT_FOUND",
  "PTA_HOUSEHOLD_NOT_FOUND",
  "PTA_STUDENT_NOT_FOUND",
  "PTA_GRADE_NOT_FOUND",
  "PTA_CLASSROOM_NOT_FOUND",
  "PTA_TEACHER_NOT_FOUND",
  "PTA_OPPORTUNITY_NOT_FOUND",
  "PTA_SLOT_NOT_FOUND",
  "PTA_SLOT_FULL",
  "PTA_SIGNUP_NOT_FOUND",
  "PTA_SIGNUP_ALREADY_EXISTS",
  "PTA_COMMITTEE_NOT_FOUND",
  "PTA_EVENT_NOT_FOUND",
  "PTA_MEETING_NOT_FOUND",
  "PTA_VALIDATION_ERROR",
  "PTA_NOT_A_HOUSEHOLD_MEMBER",
  "PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY",
  "PTA_HOUSEHOLD_INACTIVE",
  "PTA_CANCELLATION_DEADLINE_PASSED",
  "PTA_OPPORTUNITY_SIGNUP_CLOSED",
  "PTA_ATTENDANCE_NOT_FOUND",
  "PTA_ATTENDANCE_INVALID_TIMES",
  "PTA_HOUR_ENTRY_NOT_FOUND",
  "PTA_HOUR_ENTRY_ALREADY_FINALIZED",
  "PTA_SELF_APPROVAL_FORBIDDEN",
] as const;

export type PtaErrorCode = (typeof PTA_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<PtaErrorCode, number> = {
  PTA_NOT_ENABLED: 403,
  PTA_ORGANIZATION_NOT_PTA_VERTICAL: 403,
  PTA_ORGANIZATION_INACTIVE: 403,
  PTA_PROFILE_NOT_FOUND: 404,
  PTA_HOUSEHOLD_NOT_FOUND: 404,
  PTA_STUDENT_NOT_FOUND: 404,
  PTA_GRADE_NOT_FOUND: 404,
  PTA_CLASSROOM_NOT_FOUND: 404,
  PTA_TEACHER_NOT_FOUND: 404,
  PTA_OPPORTUNITY_NOT_FOUND: 404,
  PTA_SLOT_NOT_FOUND: 404,
  PTA_SLOT_FULL: 409,
  PTA_SIGNUP_NOT_FOUND: 404,
  PTA_SIGNUP_ALREADY_EXISTS: 409,
  PTA_COMMITTEE_NOT_FOUND: 404,
  PTA_EVENT_NOT_FOUND: 404,
  PTA_MEETING_NOT_FOUND: 404,
  PTA_VALIDATION_ERROR: 400,
  PTA_NOT_A_HOUSEHOLD_MEMBER: 403,
  PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY: 409,
  PTA_HOUSEHOLD_INACTIVE: 403,
  PTA_CANCELLATION_DEADLINE_PASSED: 409,
  PTA_OPPORTUNITY_SIGNUP_CLOSED: 409,
  PTA_ATTENDANCE_NOT_FOUND: 404,
  PTA_ATTENDANCE_INVALID_TIMES: 400,
  PTA_HOUR_ENTRY_NOT_FOUND: 404,
  PTA_HOUR_ENTRY_ALREADY_FINALIZED: 409,
  PTA_SELF_APPROVAL_FORBIDDEN: 403,
};

export class PtaError extends Error {
  readonly code: PtaErrorCode;
  readonly status: number;

  constructor(code: PtaErrorCode, message: string) {
    super(message);
    this.name = "PtaError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}
