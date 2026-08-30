import type { PtaVolunteerRateLockTiming, PtaVolunteerRateType } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { getVolunteerRequirementPeriod } from "./periods";
import { resolveOrgWallTimeToUtc } from "./timezone";

/** FC-6: `startAt`/`endAt` are zone-less wall-clock strings from
 * `<input type="datetime-local">` ("YYYY-MM-DDTHH:mm"), resolved against
 * the owning period's own snapshotted `timezone` — never `Date`-typed at
 * this layer, for the same reason as `VolunteerRequirementPeriodInput`
 * (periods.ts). */
export interface PricingWindowInput {
  name: string;
  startAt: string;
  endAt: string;
  rateType: PtaVolunteerRateType;
  amountCents: number;
  /** FC-10 (fix/pta-volunteer-financial-controls): stored, but NOT YET
   * enforced anywhere — no code path restricts a window marked
   * contractSigningOnly=true to a household's first election only; every
   * election/checkout can use it exactly like any other active window of
   * the same rateType. The create-window admin UI no longer offers this as
   * a choice (removed rather than left as a promise the backend doesn't
   * keep — see PtaVolunteerPricingWindowsManager.tsx); this field remains
   * settable via the API/schema only so an already-true value (none exist
   * in production or dev as of this correction) isn't silently reinterpreted,
   * and so real enforcement can be added later without a migration. */
  contractSigningOnly?: boolean;
  active?: boolean;
  lockTiming?: PtaVolunteerRateLockTiming;
}

interface ResolvedPricingWindowDates {
  startAt: Date;
  endAt: Date;
}

function validatePricingWindowInput(input: PricingWindowInput, dates: ResolvedPricingWindowDates) {
  if (!input.name.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "The pricing window needs a name.");
  }
  if (dates.startAt >= dates.endAt) {
    throw new PtaError("PTA_VALIDATION_ERROR", "The pricing window's end must be after its start.");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "The rate must be a non-negative whole number of cents.");
  }
}

/** Rejects a new/edited window whose [startAt, endAt) intersects another
 * ACTIVE window of the SAME rateType in the SAME period — an inactive
 * window can freely overlap since it's not live, mirroring how a DRAFT
 * requirement period never conflicts with anything (periods.ts). Never
 * silently averages or picks a "best" rate between ambiguous windows. */
async function assertNoOverlap(periodId: string, rateType: PtaVolunteerRateType, active: boolean | undefined, dates: ResolvedPricingWindowDates, excludeWindowId?: string) {
  if (active === false) return;

  const candidates = await prisma.ptaVolunteerPricingWindow.findMany({
    where: {
      periodId,
      rateType,
      active: true,
      id: excludeWindowId ? { not: excludeWindowId } : undefined,
    },
    select: { id: true, name: true, startAt: true, endAt: true },
  });

  const conflict = candidates.find((c) => dates.startAt < c.endAt && c.startAt < dates.endAt);
  if (conflict) {
    throw new PtaError(
      "PTA_VALIDATION_ERROR",
      `This window's dates overlap with the already-active "${conflict.name}" window for the same rate type. Adjust the dates or deactivate one of them.`
    );
  }
}

export async function listPricingWindows(organizationId: string, periodId: string) {
  await getVolunteerRequirementPeriod(organizationId, periodId);
  return prisma.ptaVolunteerPricingWindow.findMany({
    where: { organizationId, periodId },
    orderBy: [{ rateType: "asc" }, { startAt: "asc" }],
  });
}

export async function createPricingWindow(
  organizationId: string,
  periodId: string,
  input: PricingWindowInput,
  actor: { userId: string; userEmail?: string | null }
) {
  const period = await getVolunteerRequirementPeriod(organizationId, periodId);
  const dates: ResolvedPricingWindowDates = {
    startAt: resolveOrgWallTimeToUtc(input.startAt, period.timezone),
    endAt: resolveOrgWallTimeToUtc(input.endAt, period.timezone),
  };
  validatePricingWindowInput(input, dates);
  await assertNoOverlap(periodId, input.rateType, input.active, dates);

  const window = await prisma.ptaVolunteerPricingWindow.create({
    data: {
      organizationId,
      periodId,
      name: input.name.trim(),
      startAt: dates.startAt,
      endAt: dates.endAt,
      timezone: period.timezone,
      rateType: input.rateType,
      amountCents: input.amountCents,
      contractSigningOnly: input.contractSigningOnly ?? false,
      active: input.active ?? true,
      lockTiming: input.lockTiming ?? "CHECKOUT",
      createdByUserId: actor.userId,
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.pricing_window_created",
    entityType: "pta_volunteer_pricing_window",
    entityId: window.id,
    metadata: { periodId, rateType: window.rateType, amountCents: window.amountCents, startAt: window.startAt, endAt: window.endAt },
  });

  return window;
}

export async function updatePricingWindow(
  organizationId: string,
  periodId: string,
  windowId: string,
  input: PricingWindowInput,
  actor: { userId: string; userEmail?: string | null }
) {
  const existing = await prisma.ptaVolunteerPricingWindow.findFirst({ where: { id: windowId, organizationId, periodId } });
  if (!existing) throw new PtaError("PTA_VALIDATION_ERROR", "Pricing window not found in this organization.");
  // FC-6: resolved against the window's own already-snapshotted timezone
  // (same as PtaVolunteerRequirementPeriod update), not the period's
  // possibly-different current one and not re-fetched from OrgSettings.
  const dates: ResolvedPricingWindowDates = {
    startAt: resolveOrgWallTimeToUtc(input.startAt, existing.timezone),
    endAt: resolveOrgWallTimeToUtc(input.endAt, existing.timezone),
  };
  validatePricingWindowInput(input, dates);
  await assertNoOverlap(periodId, input.rateType, input.active, dates, windowId);

  const window = await prisma.ptaVolunteerPricingWindow.update({
    where: { id: windowId },
    data: {
      name: input.name.trim(),
      startAt: dates.startAt,
      endAt: dates.endAt,
      rateType: input.rateType,
      amountCents: input.amountCents,
      contractSigningOnly: input.contractSigningOnly ?? false,
      active: input.active ?? true,
      lockTiming: input.lockTiming ?? "CHECKOUT",
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.pricing_window_updated",
    entityType: "pta_volunteer_pricing_window",
    entityId: window.id,
    metadata: {
      before: { amountCents: existing.amountCents, active: existing.active },
      after: { amountCents: window.amountCents, active: window.active },
    },
  });

  return window;
}

export async function deletePricingWindow(
  organizationId: string,
  windowId: string,
  actor: { userId: string; userEmail?: string | null }
) {
  const existing = await prisma.ptaVolunteerPricingWindow.findFirst({ where: { id: windowId, organizationId } });
  if (!existing) throw new PtaError("PTA_VALIDATION_ERROR", "Pricing window not found in this organization.");

  await prisma.ptaVolunteerPricingWindow.delete({ where: { id: windowId } });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.pricing_window_deleted",
    entityType: "pta_volunteer_pricing_window",
    entityId: windowId,
    metadata: { periodId: existing.periodId, rateType: existing.rateType, amountCents: existing.amountCents },
  });
}

/**
 * The server-side source of truth for "what does this cost right now" —
 * selects the ACTIVE, non-contract-linked window of the requested rateType
 * whose [startAt, endAt) contains `atInstant`. Returns null when nothing is
 * configured for that moment/type (caller decides what that means — e.g.
 * buyout unavailable). Never trusts a client-supplied price; every
 * checkout/assessment call site must call this (or resolve via the snapshot
 * already stored on a completed purchase) rather than accept a rate from
 * the request body.
 *
 * feature/pta-family-agreement-buyout: `contractSigningOnly` is now an
 * explicit `false` filter here (previously this query didn't filter on it
 * at all — FC-10's own finding was that the field was completely inert;
 * this is the "replace the inert boolean with a real relational model"
 * change the spec calls for). Safe, non-breaking tightening: zero
 * contractSigningOnly=true rows exist anywhere as of this change (RV-8),
 * so no existing quote/election/checkout path's resolved window changes.
 *
 * When `options.contractLinkedResolutionInstant` is supplied — meaning the
 * caller has ALREADY verified the household's contract-linked eligibility
 * via agreements.ts's `resolveHouseholdAgreementStatus` — a
 * `contractSigningOnly=true` window active at THAT instant is preferred
 * over the regular one, evaluated separately (frozen at acceptance time, or
 * "now," depending on the period's `contractLinkedUsesAcceptanceRate`
 * setting — the caller decides which instant to pass). Falls through to the
 * regular resolution at `atInstant` if no contract-linked window is active
 * at that instant, so a PTA is never forced to also deactivate its regular
 * window during a contract-linked offer period.
 */
export async function resolveVolunteerBuyoutRate(
  organizationId: string,
  periodId: string,
  rateType: PtaVolunteerRateType,
  atInstant: Date = new Date(),
  options?: { contractLinkedResolutionInstant?: Date }
) {
  if (options?.contractLinkedResolutionInstant) {
    const contractLinkedWindow = await prisma.ptaVolunteerPricingWindow.findFirst({
      where: {
        organizationId,
        periodId,
        rateType,
        active: true,
        contractSigningOnly: true,
        startAt: { lte: options.contractLinkedResolutionInstant },
        endAt: { gt: options.contractLinkedResolutionInstant },
      },
      orderBy: { startAt: "desc" },
    });
    if (contractLinkedWindow) return contractLinkedWindow;
  }

  return prisma.ptaVolunteerPricingWindow.findFirst({
    where: {
      organizationId,
      periodId,
      rateType,
      active: true,
      contractSigningOnly: false,
      startAt: { lte: atInstant },
      endAt: { gt: atInstant },
    },
    orderBy: { startAt: "desc" },
  });
}
