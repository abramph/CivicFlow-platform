/**
 * Union Case Center (UNION-CASE-A) — stable, machine-readable error codes.
 * Every code maps to a fixed HTTP status so routes never have to guess
 * (mirrors src/lib/hoa/errors.ts's pattern).
 */
export const UNION_ERROR_CODES = [
  /** Organization.primaryVertical is not UNION, or the "caseManagement"
   * capability isn't enabled for it — the authoritative reason all Union
   * Case Center access is denied. */
  "UNION_CASE_MANAGEMENT_NOT_ENABLED",
  /** The organization is UNION but not currently active (suspended/cancelled). */
  "UNION_ORGANIZATION_INACTIVE",
  "UNION_CASE_NOT_FOUND",
  "UNION_CASE_VALIDATION_ERROR",
  /** Attempted a status transition the state machine doesn't allow from the
   * case's current status (e.g. NEW -> CLOSED directly). */
  "UNION_CASE_INVALID_TRANSITION",
  /** The caller is not the member this case belongs to — member self-service
   * path only, mirrors HOA_ARCHITECTURAL_REQUEST_NOT_YOURS. Never used on
   * the staff path, which uses ordinary permission checks instead. */
  "UNION_CASE_NOT_YOURS",
  /** The member has no active OrgMember record in this organization — used
   * on the intake path, which needs a real member identity to attach a new
   * case to (not merely a MEMBER web session, which can outlive a
   * membership's active status). */
  "UNION_CASE_MEMBER_NOT_ACTIVE",
  /** The assigned-to org member id does not resolve to an active member of
   * this organization. */
  "UNION_CASE_ASSIGNEE_NOT_FOUND",
  "UNION_CASE_DEADLINE_NOT_FOUND",
] as const;

export type UnionErrorCode = (typeof UNION_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<UnionErrorCode, number> = {
  UNION_CASE_MANAGEMENT_NOT_ENABLED: 403,
  UNION_ORGANIZATION_INACTIVE: 403,
  UNION_CASE_NOT_FOUND: 404,
  UNION_CASE_VALIDATION_ERROR: 400,
  UNION_CASE_INVALID_TRANSITION: 409,
  UNION_CASE_NOT_YOURS: 403,
  UNION_CASE_MEMBER_NOT_ACTIVE: 403,
  UNION_CASE_ASSIGNEE_NOT_FOUND: 404,
  UNION_CASE_DEADLINE_NOT_FOUND: 404,
};

export class UnionError extends Error {
  readonly code: UnionErrorCode;
  readonly status: number;

  constructor(code: UnionErrorCode, message: string) {
    super(message);
    this.name = "UnionError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}
