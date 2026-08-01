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
  /** Attempted to assign a member from a different organization to a
   * property, or a property id that belongs to a different organization. */
  "HOA_CROSS_TENANT_DENIED",
  /** The property is archived (status INACTIVE) — most write operations
   * are blocked; some reads are still allowed for historical reference. */
  "HOA_PROPERTY_ARCHIVED",
  /** The relationship being modified has already ended. */
  "HOA_RELATIONSHIP_ALREADY_ENDED",
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
  HOA_CROSS_TENANT_DENIED: 403,
  HOA_PROPERTY_ARCHIVED: 409,
  HOA_RELATIONSHIP_ALREADY_ENDED: 409,
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
