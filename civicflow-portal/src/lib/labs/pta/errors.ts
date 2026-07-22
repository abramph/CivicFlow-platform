/**
 * Unestra for PTA — stable, machine-readable error codes. Every code maps to
 * a fixed HTTP status so routes never have to guess (mirrors
 * meeting-intelligence/errors.ts's pattern).
 */
export const PTA_ERROR_CODES = [
  "PTA_NOT_ENABLED",
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
  "PTA_VALIDATION_ERROR",
  "PTA_NOT_A_HOUSEHOLD_MEMBER",
  "PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY",
] as const;

export type PtaErrorCode = (typeof PTA_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<PtaErrorCode, number> = {
  PTA_NOT_ENABLED: 403,
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
  PTA_VALIDATION_ERROR: 400,
  PTA_NOT_A_HOUSEHOLD_MEMBER: 403,
  PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY: 409,
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
