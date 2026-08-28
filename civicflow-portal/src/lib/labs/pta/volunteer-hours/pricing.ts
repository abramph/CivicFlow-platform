import type { PtaVolunteerRateLockTiming, PtaVolunteerRateType } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";
import { getVolunteerRequirementPeriod } from "./periods";

export interface PricingWindowInput {
  name: string;
  startAt: Date;
  endAt: Date;
  rateType: PtaVolunteerRateType;
  amountCents: number;
  contractSigningOnly?: boolean;
  active?: boolean;
  lockTiming?: PtaVolunteerRateLockTiming;
}

function validatePricingWindowInput(input: PricingWindowInput) {
  if (!input.name.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "The pricing window needs a name.");
  }
  if (input.startAt >= input.endAt) {
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
async function assertNoOverlap(periodId: string, input: PricingWindowInput, excludeWindowId?: string) {
  if (input.active === false) return;

  const candidates = await prisma.ptaVolunteerPricingWindow.findMany({
    where: {
      periodId,
      rateType: input.rateType,
      active: true,
      id: excludeWindowId ? { not: excludeWindowId } : undefined,
    },
    select: { id: true, name: true, startAt: true, endAt: true },
  });

  const conflict = candidates.find((c) => input.startAt < c.endAt && c.startAt < input.endAt);
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
  validatePricingWindowInput(input);
  await assertNoOverlap(periodId, input);

  const window = await prisma.ptaVolunteerPricingWindow.create({
    data: {
      organizationId,
      periodId,
      name: input.name.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: period.timezone,
      rateType: input.rateType,
      amountCents: input.amountCents,
      contractSigningOnly: input.contractSigningOnly ?? false,
      active: input.active ?? true,
      lockTiming: input.lockTiming ?? "PAYMENT_SUCCESS",
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
  validatePricingWindowInput(input);
  await assertNoOverlap(periodId, input, windowId);

  const window = await prisma.ptaVolunteerPricingWindow.update({
    where: { id: windowId },
    data: {
      name: input.name.trim(),
      startAt: input.startAt,
      endAt: input.endAt,
      rateType: input.rateType,
      amountCents: input.amountCents,
      contractSigningOnly: input.contractSigningOnly ?? false,
      active: input.active ?? true,
      lockTiming: input.lockTiming ?? "PAYMENT_SUCCESS",
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
 * selects the ACTIVE window of the requested rateType whose [startAt, endAt)
 * contains `atInstant`. Returns null when nothing is configured for that
 * moment/type (caller decides what that means — e.g. buyout unavailable).
 * Never trusts a client-supplied price; every checkout/assessment call site
 * must call this (or resolve via the snapshot already stored on a completed
 * purchase) rather than accept a rate from the request body.
 */
export async function resolveVolunteerBuyoutRate(
  organizationId: string,
  periodId: string,
  rateType: PtaVolunteerRateType,
  atInstant: Date = new Date()
) {
  return prisma.ptaVolunteerPricingWindow.findFirst({
    where: {
      organizationId,
      periodId,
      rateType,
      active: true,
      startAt: { lte: atInstant },
      endAt: { gt: atInstant },
    },
    orderBy: { startAt: "desc" },
  });
}
