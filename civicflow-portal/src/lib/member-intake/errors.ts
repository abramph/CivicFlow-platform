/**
 * Member Intake & Profile Update (MEMBER-QR-A) — stable, machine-readable
 * error codes. Every code maps to a fixed HTTP status so routes never have
 * to guess (mirrors src/lib/union/errors.ts's pattern).
 */
export const MEMBER_INTAKE_ERROR_CODES = [
  "MEMBER_INTAKE_NOT_ENABLED",
  "MEMBER_INTAKE_FORM_NOT_FOUND",
  "MEMBER_INTAKE_FORM_NOT_ACTIVE",
  "MEMBER_INTAKE_FORM_EXPIRED",
  "MEMBER_INTAKE_VALIDATION_ERROR",
  "MEMBER_INTAKE_FIELD_KEY_TAKEN",
  "MEMBER_INTAKE_INVALID_TARGET_FIELD",
  "MEMBER_INTAKE_SOURCE_NOT_FOUND",
  "MEMBER_INTAKE_SUBMISSION_NOT_FOUND",
  "MEMBER_INTAKE_INVALID_STATUS_TRANSITION",
  /** A verification token was requested/consumed for a submission that
   * doesn't require verification, has no matched member, or already has an
   * unconsumed token in flight (rate-limit-adjacent, not itself the rate
   * limiter). */
  "MEMBER_INTAKE_VERIFICATION_NOT_APPLICABLE",
  "MEMBER_INTAKE_VERIFICATION_TOKEN_INVALID",
  "MEMBER_INTAKE_VERIFICATION_TOKEN_EXPIRED",
  "MEMBER_INTAKE_VERIFICATION_TOKEN_CONSUMED",
] as const;

export type MemberIntakeErrorCode = (typeof MEMBER_INTAKE_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<MemberIntakeErrorCode, number> = {
  MEMBER_INTAKE_NOT_ENABLED: 403,
  MEMBER_INTAKE_FORM_NOT_FOUND: 404,
  MEMBER_INTAKE_FORM_NOT_ACTIVE: 404,
  MEMBER_INTAKE_FORM_EXPIRED: 404,
  MEMBER_INTAKE_VALIDATION_ERROR: 400,
  MEMBER_INTAKE_FIELD_KEY_TAKEN: 409,
  MEMBER_INTAKE_INVALID_TARGET_FIELD: 400,
  MEMBER_INTAKE_SOURCE_NOT_FOUND: 404,
  MEMBER_INTAKE_SUBMISSION_NOT_FOUND: 404,
  MEMBER_INTAKE_INVALID_STATUS_TRANSITION: 409,
  MEMBER_INTAKE_VERIFICATION_NOT_APPLICABLE: 409,
  MEMBER_INTAKE_VERIFICATION_TOKEN_INVALID: 400,
  MEMBER_INTAKE_VERIFICATION_TOKEN_EXPIRED: 400,
  MEMBER_INTAKE_VERIFICATION_TOKEN_CONSUMED: 400,
};

export class MemberIntakeError extends Error {
  readonly code: MemberIntakeErrorCode;
  readonly status: number;

  constructor(code: MemberIntakeErrorCode, message: string) {
    super(message);
    this.name = "MemberIntakeError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}
