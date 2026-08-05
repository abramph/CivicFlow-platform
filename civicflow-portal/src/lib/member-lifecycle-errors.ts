/**
 * Stable, machine-readable error codes for the member termination/reinstatement
 * workflow (docs/member-lifecycle-termination.md). Mirrors src/lib/hoa/errors.ts's
 * pattern: every code maps to a fixed HTTP status so routes never have to guess.
 */
export const MEMBER_LIFECYCLE_ERROR_CODES = [
  "MEMBER_NOT_FOUND",
  "INSUFFICIENT_PERMISSION",
  "TERMINATION_REASON_REQUIRED",
  "INVALID_EFFECTIVE_DATE",
  /** Compare-and-swap loss: another request already moved this member to
   * "terminated" between when the caller read it and when their write landed. */
  "MEMBER_ALREADY_TERMINATED",
  /** Terminating this member's linked login would leave the organization with
   * no active ORG_OWNER/SUPER_ADMIN. */
  "LAST_OWNER_CANNOT_BE_TERMINATED",
  "REINSTATEMENT_REASON_REQUIRED",
  /** Compare-and-swap loss on reinstate: the member is no longer "terminated"
   * (e.g. someone else already reinstated them). */
  "MEMBER_NOT_TERMINATED",
] as const;

export type MemberLifecycleErrorCode = (typeof MEMBER_LIFECYCLE_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<MemberLifecycleErrorCode, number> = {
  MEMBER_NOT_FOUND: 404,
  INSUFFICIENT_PERMISSION: 403,
  TERMINATION_REASON_REQUIRED: 400,
  INVALID_EFFECTIVE_DATE: 400,
  MEMBER_ALREADY_TERMINATED: 409,
  LAST_OWNER_CANNOT_BE_TERMINATED: 409,
  REINSTATEMENT_REASON_REQUIRED: 400,
  MEMBER_NOT_TERMINATED: 409,
};

export class MemberLifecycleError extends Error {
  readonly code: MemberLifecycleErrorCode;
  readonly status: number;

  constructor(code: MemberLifecycleErrorCode, message: string) {
    super(message);
    this.name = "MemberLifecycleError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}
