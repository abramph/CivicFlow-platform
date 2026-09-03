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
  // PTA Vertical 2.0, PR PTA-A — school years & board foundation.
  "PTA_SCHOOL_YEAR_NOT_FOUND",
  "PTA_BOARD_POSITION_NOT_FOUND",
  "PTA_OFFICER_ASSIGNMENT_NOT_FOUND",
  // PTA Vertical 2.0, PR PTA-E — concerns & grievances.
  /** Feature switched off via PtaProfile.concernsEnabled. */
  "PTA_CONCERNS_DISABLED",
  /** Also used for restricted cases the caller may not read — existence of
   * restricted content is never confirmed to unauthorized viewers. */
  "PTA_CONCERN_NOT_FOUND",
  "PTA_CONCERN_FORBIDDEN",
  // PTA Vertical 2.0, PR PTA-F — board transition center.
  "PTA_TRANSITION_NOT_FOUND",
  "PTA_HANDOFF_NOT_FOUND",
  // PTA Vertical 2.0, PR PTA-I — compliance calendar.
  "PTA_COMPLIANCE_NOT_FOUND",
  // PTA Vertical 2.0, PR PTA-L — elections.
  "PTA_ELECTIONS_DISABLED",
  "PTA_ELECTION_NOT_FOUND",
  "PTA_NOT_ELIGIBLE_VOTER",
  "PTA_ALREADY_VOTED",
  // Volunteer Hour Requirements & Buyout program (docs/pta-volunteer-hours.md).
  /** Platform-wide env kill-switch is off — checked before any org flag. */
  "PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED",
  /** Platform switch is on, but this organization isn't on the pilot
   * allowlist (PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS) — checked before any org
   * flag, same as the platform switch itself. Deliberately the same message
   * shape as PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED so a caller can't
   * distinguish "platform off" from "not allowlisted" from the response
   * alone. */
  "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
  /** PtaProfile.ptaVolunteerRequirementsEnabled is false for this org. */
  "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
  /** PtaProfile.ptaVolunteerBuyoutEnabled is false for this org. */
  "PTA_VOLUNTEER_BUYOUT_DISABLED",
  /** PtaProfile.ptaVolunteerAssessmentsEnabled is false for this org. */
  "PTA_VOLUNTEER_ASSESSMENTS_DISABLED",
  /** PtaProfile.ptaVolunteerReportsEnabled is false for this org. */
  "PTA_VOLUNTEER_REPORTS_DISABLED",
  /** PtaProfile.ptaVolunteerNotificationsEnabled is false for this org
   * (automated sends only — admin preview/test-send bypasses this code). */
  "PTA_VOLUNTEER_NOTIFICATIONS_DISABLED",
  "PTA_VOLUNTEER_PERIOD_NOT_FOUND",
  /** A new/edited period would create an ambiguous overlap with another
   * ACTIVE period sharing the same scopeLabel (or both null). */
  "PTA_VOLUNTEER_PERIOD_CONFLICT",
  "PTA_VOLUNTEER_PERIOD_INVALID_DATES",
  /** RV-4: the period's buyout POLICY fields (full-buyout-allowed,
   * min/max purchase, mandatory-service floor, purchase increment) fail
   * internal validation — see validateBuyoutPolicy in periods.ts. */
  "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY",
  /** fix/pta-volunteer-settings-atomic-audit: the atomic flag-update's
   * conditional updateMany matched zero rows — another request changed one
   * of the same flags between this request's read and write. Mirrors
   * INTERNAL_TRIAL_CONCURRENT_CONFLICT's conditional-update idiom. */
  "PTA_VOLUNTEER_HOURS_FLAGS_CONCURRENT_CONFLICT",
  // fix/pta-volunteer-financial-controls, FC-5 — server-side buyout-window
  // enforcement (docs/pta-volunteer-hours-pricing-lock-design.md's sibling
  // gaps). Stable, non-sensitive codes: never reveal WHY in a way that
  // leaks other households'/periods' data, just the boundary that applies.
  /** The requirement period this quote/election/checkout targets isn't
   * ACTIVE (still DRAFT, or already CLOSED/ARCHIVED). */
  "PTA_VOLUNTEER_PERIOD_NOT_ACTIVE",
  /** Before the period's buyoutWindowStart (inclusive-open boundary). */
  "PTA_VOLUNTEER_BUYOUT_NOT_YET_OPEN",
  /** At or after the period's buyoutWindowEnd (exclusive-close boundary) —
   * also the "quote/election has expired" case, since a quote here is
   * never a separately-persisted object with its own TTL; its validity is
   * always bounded by this same window (see the pricing-lock design note,
   * §4). */
  "PTA_VOLUNTEER_BUYOUT_CLOSED",
  /** No active PtaVolunteerPricingWindow covers the requested rate type
   * right now — nothing to quote at all. */
  "PTA_VOLUNTEER_NO_APPLICABLE_RATE",
  /** The household is exempt from this period's requirement — there is
   * nothing to buy out. */
  "PTA_VOLUNTEER_HOUSEHOLD_EXEMPT",
  /** The household's requirement is already fully met by verified hours,
   * completed purchases, and/or reserved (recent, still-pending) purchases
   * — no remaining hours are available to buy out. */
  "PTA_VOLUNTEER_ALREADY_SATISFIED",
  // FC-7 — assessment dates must control behavior, not decorate UI.
  /** The period's assessmentDate (the cutoff/effective instant) hasn't been
   * reached yet — a batch may be PREVIEWED anytime (no side effects) but
   * not POSTED before this instant. */
  "PTA_VOLUNTEER_ASSESSMENT_NOT_YET_DUE",
  // FC-8 — database-backed duplicate-assessment-charge prevention.
  /** A non-VOID assessment charge already exists for this
   * (organization, period, household) — enforced by a real partial unique
   * index (see the schema-drift warning on PtaVolunteerAssessmentCharge),
   * not just an application-layer check. Surfaced when a line loses that
   * race at post time; the line is auto-excluded rather than double-charged. */
  "PTA_VOLUNTEER_ASSESSMENT_ALREADY_CHARGED",
  // RV-11 — assessment reversal remains a hard boundary; live posting is
  // gated behind its own separate kill-switch (isPtaVolunteerAssessmentPostingEnabled)
  // until an assessment adjustment/reversal design is separately authorized.
  // Preview is never gated by this.
  "PTA_VOLUNTEER_ASSESSMENT_POSTING_BLOCKED",
  // RV-2 — database-backed duplicate-PENDING-purchase prevention.
  /** Lost a genuine concurrent race against
   * PtaVolunteerBuyoutPurchase_org_period_household_pending (see the
   * schema-drift warning on that model) AND the winning concurrent
   * purchase's own Stripe Checkout Session isn't reusable yet (it hasn't
   * reached Stripe, or retrieval failed) — never silently duplicated,
   * never silently superseded; the caller is asked to retry shortly, by
   * which point the winner's session should be reusable. */
  "PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS",
  // feature/pta-family-agreement-buyout
  "PTA_VOLUNTEER_AGREEMENT_VERSION_NOT_FOUND",
  "PTA_VOLUNTEER_AGREEMENT_NOT_DRAFT",
  "PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED",
  // feature/pta-family-agreement-buyout follow-up (FA2)
  /** deletePtaHousehold's pre-delete guard: a household with any real
   * PtaVolunteerAgreementAcceptance history cannot be hard-deleted — this
   * is now a friendly pre-check in front of an actual DB-level ON DELETE
   * RESTRICT (as of the FA3 retention-hardening migration), not the only
   * thing preventing the loss — mirrors PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY. */
  "PTA_HOUSEHOLD_HAS_AGREEMENT_HISTORY",
  // feature/pta-family-agreement-buyout follow-up (FA3 §2): the same
  // retention-hardening migration also moved buyout election/purchase,
  // assessment charge, and hour dispute householdId FKs to RESTRICT.
  /** deletePtaHousehold's pre-delete guard for the remaining four
   * household-scoped historical/financial models — a single combined code
   * (rather than one per model) since the remedy is identical in every
   * case: deactivate instead of hard-deleting. */
  "PTA_HOUSEHOLD_HAS_VOLUNTEER_FINANCIAL_HISTORY",
  /** archiveAgreementVersion: cannot archive a version that is the period's
   * CURRENTLY assigned/required agreement without an atomic replacement —
   * archiving would silently strand `agreementRequired=true` pointing at a
   * version new households can no longer be shown as "the" agreement. */
  "PTA_VOLUNTEER_AGREEMENT_ACTIVELY_REQUIRED",
  /** resolveHouseholdAgreementStatus: an acceptance's snapshotted content
   * hash no longer matches the assigned version's live hash — structurally
   * should never happen (published content is immutable), so surfacing
   * this loudly rather than silently proceeding is the "fails closed"
   * behavior FA2 §5 requires. */
  "PTA_VOLUNTEER_AGREEMENT_CONTENT_HASH_MISMATCH",
  // feature/pta-family-agreement-buyout follow-up (FA4 §2)
  /** acceptAgreement: neither the accepting adult's PtaHouseholdAdult.name
   * nor the authenticated user's own displayName/email yielded a
   * non-blank signer identity. signerDisplayNameAtAcceptance is permanent
   * historical evidence of who acknowledged the agreement, so this fails
   * the acceptance rather than falling back to a placeholder string —
   * the remedy is for an admin to add a name to the household adult
   * record, not for the system to invent one. */
  "PTA_VOLUNTEER_AGREEMENT_SIGNER_UNRESOLVED",
  // Academic-year student progression.
  /** Platform-wide env kill-switch is off — checked before any org flag,
   * covers both preview and commit (unlike the volunteer-hours program,
   * this one switch covers the whole feature, since even a preview reads
   * and displays real cross-household student data). */
  "PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED",
  /** PtaProfile.studentProgressionEnabled is false for this org. */
  "PTA_STUDENT_PROGRESSION_DISABLED",
  "PTA_PROGRESSION_BATCH_NOT_FOUND",
  "PTA_PROGRESSION_RECORD_NOT_FOUND",
  /** A batch already exists for this exact (fromYear, toYear) pair — the
   * DB-level unique constraint's friendly front door. Use the correction
   * workflow on the existing batch instead of creating a second one. */
  "PTA_PROGRESSION_BATCH_ALREADY_EXISTS",
  /** Commit was requested before any preview exists for this batch. */
  "PTA_PROGRESSION_BATCH_NOT_PREVIEWED",
  /** Commit was requested with a previewVersion that no longer matches the
   * batch's current previewedAt — the preview was regenerated (or the
   * batch's state changed) since the caller last fetched it. Re-fetch the
   * preview and confirm again before retrying commit. */
  "PTA_PROGRESSION_BATCH_STALE_PREVIEW",
  /** Commit was requested with a NEW idempotency key against a batch that
   * is already COMMITTED under a different key — a genuinely new commit
   * attempt, not a safe retry of the original one. */
  "PTA_PROGRESSION_BATCH_ALREADY_COMMITTED",
  /** A completed/committed batch's records are historical — corrections go
   * through the dedicated correction endpoint, never a raw record edit. */
  "PTA_PROGRESSION_BATCH_NOT_CORRECTABLE",
  /** Rollback blocked: at least one target-year enrollment created by this
   * batch already has dependent volunteer-ledger activity recorded against
   * it. Use the correction workflow for individual records instead. */
  "PTA_PROGRESSION_ROLLBACK_BLOCKED_DEPENDENT_ACTIVITY",
  /** toSchoolYearId must chronologically follow fromSchoolYearId (by parsed
   * "YYYY-YYYY" label) — a rollover can't progress a student into the past. */
  "PTA_PROGRESSION_INVALID_YEAR_ORDER",
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
  PTA_SCHOOL_YEAR_NOT_FOUND: 404,
  PTA_BOARD_POSITION_NOT_FOUND: 404,
  PTA_OFFICER_ASSIGNMENT_NOT_FOUND: 404,
  PTA_CONCERNS_DISABLED: 403,
  PTA_CONCERN_NOT_FOUND: 404,
  PTA_CONCERN_FORBIDDEN: 403,
  PTA_TRANSITION_NOT_FOUND: 404,
  PTA_HANDOFF_NOT_FOUND: 404,
  PTA_COMPLIANCE_NOT_FOUND: 404,
  PTA_ELECTIONS_DISABLED: 403,
  PTA_ELECTION_NOT_FOUND: 404,
  PTA_NOT_ELIGIBLE_VOTER: 403,
  PTA_ALREADY_VOTED: 409,
  PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED: 403,
  PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED: 403,
  PTA_VOLUNTEER_REQUIREMENTS_DISABLED: 403,
  PTA_VOLUNTEER_BUYOUT_DISABLED: 403,
  PTA_VOLUNTEER_ASSESSMENTS_DISABLED: 403,
  PTA_VOLUNTEER_REPORTS_DISABLED: 403,
  PTA_VOLUNTEER_NOTIFICATIONS_DISABLED: 403,
  PTA_VOLUNTEER_PERIOD_NOT_FOUND: 404,
  PTA_VOLUNTEER_PERIOD_CONFLICT: 409,
  PTA_VOLUNTEER_PERIOD_INVALID_DATES: 400,
  PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY: 400,
  PTA_VOLUNTEER_HOURS_FLAGS_CONCURRENT_CONFLICT: 409,
  PTA_VOLUNTEER_PERIOD_NOT_ACTIVE: 409,
  PTA_VOLUNTEER_BUYOUT_NOT_YET_OPEN: 409,
  PTA_VOLUNTEER_BUYOUT_CLOSED: 409,
  PTA_VOLUNTEER_NO_APPLICABLE_RATE: 409,
  PTA_VOLUNTEER_HOUSEHOLD_EXEMPT: 409,
  PTA_VOLUNTEER_ALREADY_SATISFIED: 409,
  PTA_VOLUNTEER_ASSESSMENT_NOT_YET_DUE: 409,
  PTA_VOLUNTEER_ASSESSMENT_ALREADY_CHARGED: 409,
  PTA_VOLUNTEER_ASSESSMENT_POSTING_BLOCKED: 403,
  PTA_VOLUNTEER_CHECKOUT_IN_PROGRESS: 409,
  PTA_VOLUNTEER_AGREEMENT_VERSION_NOT_FOUND: 404,
  PTA_VOLUNTEER_AGREEMENT_NOT_DRAFT: 409,
  PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED: 409,
  PTA_HOUSEHOLD_HAS_AGREEMENT_HISTORY: 409,
  PTA_HOUSEHOLD_HAS_VOLUNTEER_FINANCIAL_HISTORY: 409,
  PTA_VOLUNTEER_AGREEMENT_ACTIVELY_REQUIRED: 409,
  PTA_VOLUNTEER_AGREEMENT_CONTENT_HASH_MISMATCH: 500,
  PTA_VOLUNTEER_AGREEMENT_SIGNER_UNRESOLVED: 400,
  PTA_STUDENT_PROGRESSION_PLATFORM_DISABLED: 403,
  PTA_STUDENT_PROGRESSION_DISABLED: 403,
  PTA_PROGRESSION_BATCH_NOT_FOUND: 404,
  PTA_PROGRESSION_RECORD_NOT_FOUND: 404,
  PTA_PROGRESSION_BATCH_ALREADY_EXISTS: 409,
  PTA_PROGRESSION_BATCH_NOT_PREVIEWED: 409,
  PTA_PROGRESSION_BATCH_STALE_PREVIEW: 409,
  PTA_PROGRESSION_BATCH_ALREADY_COMMITTED: 409,
  PTA_PROGRESSION_BATCH_NOT_CORRECTABLE: 409,
  PTA_PROGRESSION_ROLLBACK_BLOCKED_DEPENDENT_ACTIVITY: 409,
  PTA_PROGRESSION_INVALID_YEAR_ORDER: 400,
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
