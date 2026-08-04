/**
 * Unestra for HOA — stable, machine-readable error codes (PR #43,
 * Property/Resident foundation only). Every code maps to a fixed HTTP
 * status so routes never have to guess (mirrors labs/pta/errors.ts's
 * pattern).
 */
export const HOA_ERROR_CODES = [
  /** Organization.primaryVertical is not HOA, or the "properties"
   * capability isn't enabled for it — the authoritative reason core HOA
   * property access is denied. */
  "HOA_ORGANIZATION_NOT_HOA_VERTICAL",
  /** The organization is HOA but not currently active (suspended/cancelled). */
  "HOA_ORGANIZATION_INACTIVE",
  "HOA_PROPERTY_NOT_FOUND",
  "HOA_RESIDENT_NOT_FOUND",
  "HOA_MEMBER_NOT_FOUND",
  "HOA_VALIDATION_ERROR",
  /** Attempted to create a second ACTIVE relationship for the same
   * (property, member) pair. */
  "HOA_DUPLICATE_ACTIVE_RELATIONSHIP",
  /** Lost a race for the one-ACTIVE-primary-contact-per-property slot —
   * distinct from HOA_DUPLICATE_ACTIVE_RELATIONSHIP so the error message
   * accurately says "someone just became primary contact" rather than the
   * misleading "you already have a relationship here." */
  "HOA_PRIMARY_CONTACT_CONFLICT",
  /** Attempted to assign a member from a different organization to a
   * property, or a property id that belongs to a different organization. */
  "HOA_CROSS_TENANT_DENIED",
  /** The property is archived (status INACTIVE) — most write operations
   * are blocked; some reads are still allowed for historical reference. */
  "HOA_PROPERTY_ARCHIVED",
  /** The relationship being modified has already ended. */
  "HOA_RELATIONSHIP_ALREADY_ENDED",

  // Violations MVP
  /** Organization.primaryVertical is HOA but the "violations" capability
   * isn't enabled for it. */
  "HOA_VIOLATIONS_NOT_ENABLED",
  "HOA_VIOLATION_NOT_FOUND",
  /** Attempted a status transition the state machine doesn't allow from
   * the violation's current status (e.g. DRAFT -> RESOLVED directly). */
  "HOA_VIOLATION_INVALID_TRANSITION",
  /** The caller is not a resident/owner of the violation's property (or
   * has no PropertyResident relationship at all) — used only on the
   * resident self-service read path, never the officer path (which uses
   * ordinary permission checks instead). */
  "HOA_VIOLATION_NOT_YOUR_PROPERTY",
  /** The violation's status changed between when the caller read it and
   * when their write was applied (a concurrent request won the race) —
   * distinct from HOA_VIOLATION_INVALID_TRANSITION, which means the
   * transition was never valid at all. The caller should refresh and
   * retry with current state, not treat this as a permanent rejection. */
  "HOA_VIOLATION_STALE_UPDATE",

  // Architectural Requests
  /** Organization.primaryVertical is HOA but the "architecturalRequests"
   * capability isn't enabled for it. */
  "HOA_ARCHITECTURAL_REQUESTS_NOT_ENABLED",
  "HOA_ARCHITECTURAL_REQUEST_NOT_FOUND",
  /** Attempted a status transition the state machine doesn't allow from the
   * request's current status. */
  "HOA_ARCHITECTURAL_REQUEST_INVALID_TRANSITION",
  /** The caller is not the submitter of this request (or has no
   * PropertyResident relationship to it at all) — resident self-service
   * path only, mirrors HOA_VIOLATION_NOT_YOUR_PROPERTY. */
  "HOA_ARCHITECTURAL_REQUEST_NOT_YOURS",
  /** Same race-safety meaning as HOA_VIOLATION_STALE_UPDATE, for
   * architectural-request status transitions. */
  "HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE",
  /** The caller's relationship to the property (RESIDENT/TENANT, or no
   * relationship at all) is not one of the types allowed to submit an
   * architectural request (OWNER/CO_OWNER/NON_RESIDENT_OWNER) — see
   * requireArchitecturalRequestSubmissionEligibility(). */
  "HOA_ARCHITECTURAL_REQUEST_INELIGIBLE_RELATIONSHIP",
] as const;

export type HoaErrorCode = (typeof HOA_ERROR_CODES)[number];

const STATUS_FOR_CODE: Record<HoaErrorCode, number> = {
  HOA_ORGANIZATION_NOT_HOA_VERTICAL: 403,
  HOA_ORGANIZATION_INACTIVE: 403,
  HOA_PROPERTY_NOT_FOUND: 404,
  HOA_RESIDENT_NOT_FOUND: 404,
  HOA_MEMBER_NOT_FOUND: 404,
  HOA_VALIDATION_ERROR: 400,
  HOA_DUPLICATE_ACTIVE_RELATIONSHIP: 409,
  HOA_PRIMARY_CONTACT_CONFLICT: 409,
  HOA_CROSS_TENANT_DENIED: 403,
  HOA_PROPERTY_ARCHIVED: 409,
  HOA_RELATIONSHIP_ALREADY_ENDED: 409,
  HOA_VIOLATIONS_NOT_ENABLED: 403,
  HOA_VIOLATION_NOT_FOUND: 404,
  HOA_VIOLATION_INVALID_TRANSITION: 409,
  HOA_VIOLATION_NOT_YOUR_PROPERTY: 403,
  HOA_VIOLATION_STALE_UPDATE: 409,
  HOA_ARCHITECTURAL_REQUESTS_NOT_ENABLED: 403,
  HOA_ARCHITECTURAL_REQUEST_NOT_FOUND: 404,
  HOA_ARCHITECTURAL_REQUEST_INVALID_TRANSITION: 409,
  HOA_ARCHITECTURAL_REQUEST_NOT_YOURS: 403,
  HOA_ARCHITECTURAL_REQUEST_STALE_UPDATE: 409,
  HOA_ARCHITECTURAL_REQUEST_INELIGIBLE_RELATIONSHIP: 403,
};

export class HoaError extends Error {
  readonly code: HoaErrorCode;
  readonly status: number;

  constructor(code: HoaErrorCode, message: string) {
    super(message);
    this.name = "HoaError";
    this.code = code;
    this.status = STATUS_FOR_CODE[code];
  }
}
