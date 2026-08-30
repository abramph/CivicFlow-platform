import type { PtaVolunteerPeriodStatus, PtaVolunteerPeriodType } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { resolveOrgWallTimeEndOfDayToUtc, resolveOrgWallTimeEndOfDayToUtcNullable, resolveOrgWallTimeToUtc, resolveOrgWallTimeToUtcNullable } from "./timezone";

/**
 * All date fields are zone-less wall-clock strings from `<input type="date">`
 * — "YYYY-MM-DD" — exactly as the admin typed them, in the organization's own
 * calendar. FC-6: never `Date`-typed at this layer; converting a wall-clock
 * string to the correct UTC instant requires knowing WHICH timezone it's in,
 * which for a create is the org's current `OrgSettings.timezone` and for an
 * update is the period's own already-snapshotted `timezone` — neither is
 * available to a caller holding only a bare `Date`.
 *
 * RV-3: `volunteerDeadline`, `buyoutWindowStart`/`buyoutWindowEnd`,
 * `assessmentDate`, and `assessmentPaymentDueDate` are five independent
 * fields with five independent meanings — some enforced server-side, some
 * purely informational. See docs/pta-volunteer-hours-date-semantics.md for
 * the authoritative per-field table; never assume one field's enforcement
 * status from another's.
 */
export interface VolunteerRequirementPeriodInput {
  name: string;
  periodType: PtaVolunteerPeriodType;
  startsOn: string;
  endsOn: string;
  requiredMinutesDefault: number;
  volunteerDeadline?: string | null;
  buyoutWindowStart?: string | null;
  buyoutWindowEnd?: string | null;
  assessmentDate?: string | null;
  assessmentPaymentDueDate?: string | null;
  status?: PtaVolunteerPeriodStatus;
  adminNotes?: string | null;
  familyPolicyText?: string | null;
  scopeLabel?: string | null;
  /**
   * RV-4: buyout POLICY LIMITS (docs/pta-volunteer-hours-date-semantics.md's
   * sibling gap — these fields were already read/enforced by
   * `elections.ts: buildBuyoutQuote` but had no write path anywhere:
   * unreachable via any UI or API, permanently stuck at their Prisma
   * defaults. All five are optional here: omitted on an update means
   * "leave unchanged" (see `resolveBuyoutField`), never "reset to default."
   * `undefined` and explicit `null` are deliberately distinct for the three
   * nullable minute fields — `null` clears a previously-set limit,
   * `undefined` preserves whatever is already stored.
   */
  buyoutFullAllowed?: boolean;
  buyoutMinPurchaseMinutes?: number | null;
  buyoutMaxPurchaseMinutes?: number | null;
  buyoutMinServiceMinutes?: number | null;
  buyoutIncrementMinutes?: number;
}

/** RV-4: the only purchase increments `elections.ts: buildBuyoutQuote`'s own
 * validation-error copy names explicitly ("whole hours" / "half hours" /
 * "15-minute blocks") — kept as a closed set so every admin-configured
 * increment has clear, pre-written family-facing error text. */
const VALID_BUYOUT_INCREMENT_MINUTES = [15, 30, 60] as const;

/**
 * RV-4: server-side validation for the buyout policy fields — an admin API
 * caller is never trusted to have applied the UI's own client-side
 * constraints. Always validated against the FULLY RESOLVED values (post
 * existing-value fallback for an update, post-default for a create), never
 * against a possibly-partial raw input, so a value carried forward from an
 * earlier save is checked exactly as strictly as a value being changed
 * right now.
 */
function validateBuyoutPolicy(resolved: {
  requiredMinutesDefault: number;
  buyoutFullAllowed: boolean;
  buyoutMinPurchaseMinutes: number | null;
  buyoutMaxPurchaseMinutes: number | null;
  buyoutMinServiceMinutes: number | null;
  buyoutIncrementMinutes: number;
}) {
  if (!(VALID_BUYOUT_INCREMENT_MINUTES as readonly number[]).includes(resolved.buyoutIncrementMinutes)) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY", "The purchase increment must be whole (60), half (30), or quarter (15) hours.");
  }

  const requireNonNegativeInteger = (value: number | null, label: string) => {
    if (value != null && (!Number.isInteger(value) || value < 0)) {
      throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY", `${label} must be a non-negative whole number of minutes.`);
    }
  };
  requireNonNegativeInteger(resolved.buyoutMinPurchaseMinutes, "The minimum purchase");
  requireNonNegativeInteger(resolved.buyoutMaxPurchaseMinutes, "The maximum purchase");
  requireNonNegativeInteger(resolved.buyoutMinServiceMinutes, "The mandatory-service floor");

  const isMultipleOfIncrement = (value: number | null) => value == null || value % resolved.buyoutIncrementMinutes === 0;
  if (!isMultipleOfIncrement(resolved.buyoutMinPurchaseMinutes)) {
    throw new PtaError(
      "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY",
      `The minimum purchase must be an exact multiple of the ${resolved.buyoutIncrementMinutes}-minute purchase increment.`
    );
  }
  if (!isMultipleOfIncrement(resolved.buyoutMaxPurchaseMinutes)) {
    throw new PtaError(
      "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY",
      `The maximum purchase must be an exact multiple of the ${resolved.buyoutIncrementMinutes}-minute purchase increment.`
    );
  }

  if (
    resolved.buyoutMinPurchaseMinutes != null &&
    resolved.buyoutMaxPurchaseMinutes != null &&
    resolved.buyoutMinPurchaseMinutes > resolved.buyoutMaxPurchaseMinutes
  ) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY", "The minimum purchase cannot be greater than the maximum purchase.");
  }

  // "Beyond the family's possible obligation" can only be checked against
  // the period's own DEFAULT here — an individual household's actual
  // requirement can be raised or lowered by a VH-B assignment override, and
  // this layer has no household to check against. `buildBuyoutQuote`'s own
  // Math.min(..., remainingMinutes) clamp (elections.ts) is what protects
  // any individual household beyond what this default-level check can see.
  const serviceFloor = resolved.buyoutMinServiceMinutes ?? 0;
  const maxBuyableAgainstDefault = Math.max(0, resolved.requiredMinutesDefault - serviceFloor);
  if (resolved.buyoutMaxPurchaseMinutes != null && resolved.buyoutMaxPurchaseMinutes > maxBuyableAgainstDefault) {
    throw new PtaError(
      "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY",
      `The maximum purchase cannot exceed ${(maxBuyableAgainstDefault / 60).toString()} hours — this period's default required hours minus the mandatory-service floor.`
    );
  }

  // A full buyout and a mandatory-service floor are contradictory: every
  // full-buyout attempt would reach buildBuyoutQuote's own
  // `serviceFloorMinutes > 0` check and be rejected regardless of this
  // flag. Rejecting the SAVE here (never silently flipping the stored
  // value to false) keeps what's stored honest — an admin sees exactly why,
  // rather than saving "full buyout: on" and discovering later it never
  // actually works.
  if (resolved.buyoutFullAllowed && serviceFloor > 0) {
    throw new PtaError(
      "PTA_VOLUNTEER_PERIOD_INVALID_BUYOUT_POLICY",
      "A full buyout can't be allowed while a mandatory-service floor is set — every full-buyout attempt would be rejected at checkout. Turn off full buyout, or remove the mandatory-service floor."
    );
  }
}

/** RV-4: `undefined` (key omitted) preserves the existing value; an explicit
 * `null` clears it. Only meaningful for the three nullable minute fields —
 * `??` is unsafe here because it would also treat an intentional `null` as
 * "missing" and silently restore the old value. */
function resolveBuyoutField(provided: number | null | undefined, existing: number | null): number | null {
  return provided === undefined ? existing : provided;
}

interface ResolvedPeriodDates {
  startsOn: Date;
  endsOn: Date;
  volunteerDeadline: Date | null;
  buyoutWindowStart: Date | null;
  buyoutWindowEnd: Date | null;
  assessmentDate: Date | null;
  assessmentPaymentDueDate: Date | null;
  /** RV-6: internal-only — never persisted (create/update's `data` blocks
   * name every field explicitly, so this is never accidentally written).
   * `endsOn` shifted forward exactly like `buyoutWindowEnd` is, so
   * `validateDates` can compare the two on equal terms: `buyoutWindowEnd`
   * closing on the period's own last calendar day must validate, not be
   * rejected as "past the period's end" just because `endsOn` itself is
   * still stored as a plain start-of-day instant. */
  periodEndInclusiveBoundary: Date;
}

/** The single point every wall-clock date field on this input passes through
 * — resolved against `timezone` (the org's current zone for a create, or the
 * period's own snapshotted zone for an update; see the input doc comment). */
function resolvePeriodDates(input: VolunteerRequirementPeriodInput, timezone: string): ResolvedPeriodDates {
  return {
    startsOn: resolveOrgWallTimeToUtc(input.startsOn, timezone),
    endsOn: resolveOrgWallTimeToUtc(input.endsOn, timezone),
    volunteerDeadline: resolveOrgWallTimeToUtcNullable(input.volunteerDeadline, timezone),
    buyoutWindowStart: resolveOrgWallTimeToUtcNullable(input.buyoutWindowStart, timezone),
    // RV-6: buyoutWindowEnd is the one EXCLUSIVE-end boundary an admin edits
    // through a bare date (not a date+time) control — resolved through the
    // inclusive-end-of-day variant so "September 30" means "through the end
    // of September 30," never "starting at midnight September 30." Every
    // other field here keeps the plain (start-of-day / exact-instant)
    // resolution — see resolveOrgWallTimeEndOfDayToUtc's doc comment for why
    // this is the one field that needs it.
    buyoutWindowEnd: resolveOrgWallTimeEndOfDayToUtcNullable(input.buyoutWindowEnd, timezone),
    assessmentDate: resolveOrgWallTimeToUtcNullable(input.assessmentDate, timezone),
    assessmentPaymentDueDate: resolveOrgWallTimeToUtcNullable(input.assessmentPaymentDueDate, timezone),
    periodEndInclusiveBoundary: resolveOrgWallTimeEndOfDayToUtc(input.endsOn, timezone),
  };
}

function validateRequiredMinutes(requiredMinutesDefault: number) {
  if (!Number.isInteger(requiredMinutesDefault) || requiredMinutesDefault < 0) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "Required hours must be a non-negative whole number of minutes.");
  }
}

function validateDates(name: string, dates: ResolvedPeriodDates) {
  if (dates.startsOn >= dates.endsOn) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "The period's end date must be after its start date.");
  }
  const withinRange = (d: Date | null, label: string, upperBound: Date = dates.endsOn) => {
    if (d && (d < dates.startsOn || d > upperBound)) {
      throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", `${label} must fall within the period's start and end dates.`);
    }
  };
  withinRange(dates.volunteerDeadline, "The volunteer completion deadline");
  withinRange(dates.buyoutWindowStart, "The buyout window start");
  // RV-6: compared against periodEndInclusiveBoundary, not dates.endsOn
  // directly — buyoutWindowEnd is already shifted forward one day (see
  // resolvePeriodDates), so a buyout window closing on the period's own
  // last calendar day must validate, not be rejected as "past the end."
  withinRange(dates.buyoutWindowEnd, "The buyout window end", dates.periodEndInclusiveBoundary);
  if (dates.buyoutWindowStart && dates.buyoutWindowEnd && dates.buyoutWindowStart >= dates.buyoutWindowEnd) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "The buyout window's end must be after its start.");
  }
  if (!name.trim()) {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_INVALID_DATES", "The period needs a name.");
  }
}

/**
 * Two ACTIVE periods are only a conflict when they share a scope (same
 * scopeLabel, or both null) AND their [startsOn, endsOn) ranges intersect.
 * Different scopeLabels are an intentional separate grouping (program,
 * campus, membership type) per the spec — this codebase has no formal
 * campus/program entity to key off instead, so scopeLabel is admin-defined
 * free text. DRAFT/CLOSED/ARCHIVED periods never conflict with anything.
 */
async function assertNoConflictingActivePeriod(
  organizationId: string,
  status: PtaVolunteerPeriodStatus | undefined,
  scopeLabel: string | null | undefined,
  dates: Pick<ResolvedPeriodDates, "startsOn" | "endsOn">,
  excludePeriodId?: string
) {
  if (status !== "ACTIVE") return;

  const candidates = await prisma.ptaVolunteerRequirementPeriod.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      id: excludePeriodId ? { not: excludePeriodId } : undefined,
      scopeLabel: scopeLabel ?? null,
    },
    select: { id: true, name: true, startsOn: true, endsOn: true },
  });

  const conflict = candidates.find((c) => dates.startsOn < c.endsOn && c.startsOn < dates.endsOn);
  if (conflict) {
    throw new PtaError(
      "PTA_VOLUNTEER_PERIOD_CONFLICT",
      `This period's dates overlap with the already-active period "${conflict.name}" in the same scope. Give one of them a distinct scope (program/campus/membership type) or adjust the dates.`
    );
  }
}

export async function listVolunteerRequirementPeriods(organizationId: string) {
  return prisma.ptaVolunteerRequirementPeriod.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { startsOn: "desc" }],
  });
}

export async function getVolunteerRequirementPeriod(organizationId: string, periodId: string) {
  const period = await prisma.ptaVolunteerRequirementPeriod.findFirst({ where: { id: periodId, organizationId } });
  if (!period) throw new PtaError("PTA_VOLUNTEER_PERIOD_NOT_FOUND", "Volunteer requirement period not found in this organization.");
  return period;
}

/**
 * fix/pta-volunteer-financial-controls, FC-5: the single server-side gate
 * every buyout quote/election/checkout must pass before a rate is even
 * looked up. `buyoutWindowStart`/`buyoutWindowEnd` were previously stored
 * and validated for internal consistency only (docs/pta-volunteer-hours-pricing-lock-design.md
 * predates this — see also the buyout architecture trace from Stage C) but
 * never enforced at runtime. Boundary semantics match FC-5's authorization:
 * open at `buyoutWindowStart` INCLUSIVE, closed at `buyoutWindowEnd`
 * EXCLUSIVE — this comparison itself is unchanged by RV-6. What RV-6
 * changed is what UTC instant `buyoutWindowEnd` actually STORES for a
 * date-only admin entry (resolvePeriodDates: resolveOrgWallTimeEndOfDayToUtcNullable)
 * — the stored instant is already the start of the day AFTER the admin's
 * typed closing date, so this exclusive comparison correctly keeps the
 * ENTIRE typed day buyable, not just up to its midnight. A period with no
 * configured window (both null) has no period-level date restriction — only
 * the pricing window's own bounds apply. Never trusts a client-supplied
 * `now`.
 */
export function assertBuyoutWindowOpen(
  period: Pick<Awaited<ReturnType<typeof getVolunteerRequirementPeriod>>, "status" | "buyoutWindowStart" | "buyoutWindowEnd">,
  now: Date = new Date()
) {
  if (period.status !== "ACTIVE") {
    throw new PtaError("PTA_VOLUNTEER_PERIOD_NOT_ACTIVE", "This requirement period isn't currently active.");
  }
  if (period.buyoutWindowStart && now < period.buyoutWindowStart) {
    throw new PtaError("PTA_VOLUNTEER_BUYOUT_NOT_YET_OPEN", "The buyout window for this period hasn't opened yet.");
  }
  if (period.buyoutWindowEnd && now >= period.buyoutWindowEnd) {
    throw new PtaError("PTA_VOLUNTEER_BUYOUT_CLOSED", "The buyout window for this period has closed.");
  }
}

/** The ACTIVE period whose date range contains right now — the default a
 * family dashboard resolves to when no periodId is specified. Null when
 * nothing is currently active (between periods, or none configured yet). */
export async function getCurrentActivePeriod(organizationId: string, at: Date = new Date()) {
  return prisma.ptaVolunteerRequirementPeriod.findFirst({
    where: { organizationId, status: "ACTIVE", startsOn: { lte: at }, endsOn: { gt: at } },
    orderBy: { startsOn: "desc" },
  });
}

export async function createVolunteerRequirementPeriod(
  organizationId: string,
  input: VolunteerRequirementPeriodInput,
  actor: { userId: string; userEmail?: string | null }
) {
  validateRequiredMinutes(input.requiredMinutesDefault);

  // FC-6: a period being CREATED has no timezone of its own yet — the org's
  // CURRENT setting is the only sensible source, exactly as this line
  // already did before FC-6 (only now it's read first, so the same
  // timezone governs both the wall-time->UTC conversion below AND the
  // snapshot stored on the row, rather than the conversion silently using
  // a different implicit zone than what gets recorded).
  const orgSettings = await prisma.orgSettings.findUnique({ where: { organizationId }, select: { timezone: true } });
  const timezone = orgSettings?.timezone ?? "America/New_York";

  const dates = resolvePeriodDates(input, timezone);
  validateDates(input.name, dates);
  await assertNoConflictingActivePeriod(organizationId, input.status, input.scopeLabel, dates);

  const buyoutPolicy = {
    buyoutFullAllowed: input.buyoutFullAllowed ?? true,
    buyoutMinPurchaseMinutes: input.buyoutMinPurchaseMinutes ?? null,
    buyoutMaxPurchaseMinutes: input.buyoutMaxPurchaseMinutes ?? null,
    buyoutMinServiceMinutes: input.buyoutMinServiceMinutes ?? null,
    buyoutIncrementMinutes: input.buyoutIncrementMinutes ?? 60,
  };
  validateBuyoutPolicy({ requiredMinutesDefault: input.requiredMinutesDefault, ...buyoutPolicy });

  const period = await prisma.ptaVolunteerRequirementPeriod.create({
    data: {
      organizationId,
      name: input.name.trim(),
      periodType: input.periodType,
      startsOn: dates.startsOn,
      endsOn: dates.endsOn,
      timezone,
      requiredMinutesDefault: input.requiredMinutesDefault,
      volunteerDeadline: dates.volunteerDeadline,
      buyoutWindowStart: dates.buyoutWindowStart,
      buyoutWindowEnd: dates.buyoutWindowEnd,
      assessmentDate: dates.assessmentDate,
      assessmentPaymentDueDate: dates.assessmentPaymentDueDate,
      status: input.status ?? "DRAFT",
      adminNotes: input.adminNotes ?? null,
      familyPolicyText: input.familyPolicyText ?? null,
      scopeLabel: input.scopeLabel?.trim() || null,
      ...buyoutPolicy,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.period_created",
    entityType: "pta_volunteer_requirement_period",
    entityId: period.id,
    metadata: { name: period.name, status: period.status, requiredMinutesDefault: period.requiredMinutesDefault },
  });

  return period;
}

export async function updateVolunteerRequirementPeriod(
  organizationId: string,
  periodId: string,
  input: VolunteerRequirementPeriodInput,
  actor: { userId: string; userEmail?: string | null }
) {
  const existing = await getVolunteerRequirementPeriod(organizationId, periodId);
  validateRequiredMinutes(input.requiredMinutesDefault);

  // FC-6: an existing period keeps the timezone it was CREATED under —
  // never re-derived from the org's (possibly since-changed) current
  // setting. Same snapshot-on-transaction discipline as every other
  // historical record in this program; an admin editing a period's dates
  // must not have those edits silently reinterpreted in a different zone
  // than the one the period's other already-stored instants were resolved
  // against.
  const dates = resolvePeriodDates(input, existing.timezone);
  validateDates(input.name, dates);
  await assertNoConflictingActivePeriod(organizationId, input.status ?? existing.status, input.scopeLabel, dates, periodId);

  const buyoutPolicy = {
    // `?? true` / `?? 60` defensively covers a genuinely-missing existing
    // value (never actually possible against a real DB row — both columns
    // are NOT NULL with a Prisma @default — but a defensive fallback here
    // matches the schema's own default rather than letting `undefined`
    // reach the DB or fail validation for a row this layer can't fully see).
    buyoutFullAllowed: input.buyoutFullAllowed ?? existing.buyoutFullAllowed ?? true,
    buyoutMinPurchaseMinutes: resolveBuyoutField(input.buyoutMinPurchaseMinutes, existing.buyoutMinPurchaseMinutes),
    buyoutMaxPurchaseMinutes: resolveBuyoutField(input.buyoutMaxPurchaseMinutes, existing.buyoutMaxPurchaseMinutes),
    buyoutMinServiceMinutes: resolveBuyoutField(input.buyoutMinServiceMinutes, existing.buyoutMinServiceMinutes),
    buyoutIncrementMinutes: input.buyoutIncrementMinutes ?? existing.buyoutIncrementMinutes ?? 60,
  };
  validateBuyoutPolicy({ requiredMinutesDefault: input.requiredMinutesDefault, ...buyoutPolicy });

  const period = await prisma.ptaVolunteerRequirementPeriod.update({
    where: { id: periodId },
    data: {
      name: input.name.trim(),
      periodType: input.periodType,
      startsOn: dates.startsOn,
      endsOn: dates.endsOn,
      requiredMinutesDefault: input.requiredMinutesDefault,
      volunteerDeadline: dates.volunteerDeadline,
      buyoutWindowStart: dates.buyoutWindowStart,
      buyoutWindowEnd: dates.buyoutWindowEnd,
      assessmentDate: dates.assessmentDate,
      assessmentPaymentDueDate: dates.assessmentPaymentDueDate,
      status: input.status ?? existing.status,
      adminNotes: input.adminNotes ?? null,
      familyPolicyText: input.familyPolicyText ?? null,
      scopeLabel: input.scopeLabel?.trim() || null,
      ...buyoutPolicy,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.period_updated",
    entityType: "pta_volunteer_requirement_period",
    entityId: period.id,
    metadata: {
      before: { status: existing.status, requiredMinutesDefault: existing.requiredMinutesDefault },
      after: { status: period.status, requiredMinutesDefault: period.requiredMinutesDefault },
    },
  });

  return period;
}
