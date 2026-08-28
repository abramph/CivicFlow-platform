import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { resolveHouseholdRequirement } from "./assignments";
import { PtaError } from "../errors";
import { getHouseholdLedgerTotals, postLedgerEntry } from "./ledger";
import { getVolunteerRequirementPeriod } from "./periods";
import { resolveVolunteerBuyoutRate } from "./pricing";

function computeRemainingMinutes(requiredMinutes: number, totals: Awaited<ReturnType<typeof getHouseholdLedgerTotals>>): number {
  return Math.max(0, requiredMinutes - totals.verifiedMinutes - totals.purchasedMinutes - totals.creditMinutes - totals.waivedMinutes);
}

/**
 * A pure computation with no side effects on obligations — persists a
 * DRAFT batch + one line per household with remainingMinutes > 0, so admin
 * edits/exclusions survive a page reload (spec §18). Reuses the EXISTING
 * DRAFT batch for this period if one is already in progress rather than
 * creating a duplicate — call cancelAssessmentBatch first to start over.
 */
export async function previewAssessmentBatch(
  organizationId: string,
  periodId: string,
  actor: { userId: string },
  options: { supersedesBatchId?: string | null } = {}
) {
  const existingDraft = await prisma.ptaVolunteerAssessmentBatch.findFirst({
    where: { organizationId, requirementPeriodId: periodId, status: "DRAFT" },
    include: { lines: { include: { household: { select: { displayName: true } } } } },
  });
  if (existingDraft) return existingDraft;

  const rateWindow = await resolveVolunteerBuyoutRate(organizationId, periodId, "FINAL_ASSESSMENT");
  if (!rateWindow) {
    throw new PtaError("PTA_VALIDATION_ERROR", "No final remaining-hours assessment rate is currently active for this period.");
  }

  const households = await prisma.ptaHousehold.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, displayName: true } });

  const lines: {
    organizationId: string;
    householdId: string;
    adjustedRequiredMinutes: number;
    verifiedMinutes: number;
    purchasedMinutes: number;
    creditMinutes: number;
    waivedMinutes: number;
    remainingMinutes: number;
    assessmentCents: number;
  }[] = [];

  for (const household of households) {
    const requirement = await resolveHouseholdRequirement(organizationId, periodId, household.id);
    if (requirement.exempt) continue;
    const totals = await getHouseholdLedgerTotals(organizationId, periodId, household.id);
    const remainingMinutes = computeRemainingMinutes(requirement.requiredMinutes, totals);
    if (remainingMinutes <= 0) continue;

    lines.push({
      organizationId,
      householdId: household.id,
      adjustedRequiredMinutes: requirement.requiredMinutes,
      verifiedMinutes: totals.verifiedMinutes,
      purchasedMinutes: totals.purchasedMinutes,
      creditMinutes: totals.creditMinutes,
      waivedMinutes: totals.waivedMinutes,
      remainingMinutes,
      assessmentCents: Math.round((remainingMinutes / 60) * rateWindow.amountCents),
    });
  }

  const batch = await prisma.ptaVolunteerAssessmentBatch.create({
    data: {
      organizationId,
      requirementPeriodId: periodId,
      status: "DRAFT",
      supersedesBatchId: options.supersedesBatchId ?? null,
      rateCents: rateWindow.amountCents,
      pricingWindowId: rateWindow.id,
      previewedByUserId: actor.userId,
      lines: { create: lines },
    },
    include: { lines: { include: { household: { select: { displayName: true } } } } },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "pta.volunteer_hours.assessment_batch_previewed",
    entityType: "pta_volunteer_assessment_batch",
    entityId: batch.id,
    metadata: { requirementPeriodId: periodId, lineCount: lines.length, rateCents: rateWindow.amountCents },
  });

  return batch;
}

export async function getAssessmentBatch(organizationId: string, batchId: string) {
  const batch = await prisma.ptaVolunteerAssessmentBatch.findFirst({
    where: { id: batchId, organizationId },
    include: { lines: { include: { household: { select: { displayName: true } } } } },
  });
  if (!batch) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment batch not found in this organization.");
  return batch;
}

export async function listAssessmentBatches(organizationId: string, periodId: string) {
  return prisma.ptaVolunteerAssessmentBatch.findMany({ where: { organizationId, requirementPeriodId: periodId }, orderBy: { createdAt: "desc" } });
}

async function setLineStatus(
  organizationId: string,
  batchId: string,
  lineId: string,
  status: "INCLUDED" | "EXCLUDED",
  reason: string | null,
  actor: { userId: string }
) {
  const batch = await prisma.ptaVolunteerAssessmentBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment batch not found in this organization.");
  if (batch.status !== "DRAFT") throw new PtaError("PTA_VALIDATION_ERROR", "Only a DRAFT batch's lines can be changed.");
  if (status === "EXCLUDED" && !reason?.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A reason is required to exclude a family from an assessment batch.");
  }

  const line = await prisma.ptaVolunteerAssessmentLine.update({
    where: { id: lineId },
    data: { status, excludeReason: status === "EXCLUDED" ? reason!.trim() : null },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: status === "EXCLUDED" ? "pta.volunteer_hours.assessment_line_excluded" : "pta.volunteer_hours.assessment_line_included",
    entityType: "pta_volunteer_assessment_line",
    entityId: line.id,
    metadata: { batchId, reason },
  });

  return line;
}

export async function excludeAssessmentLine(organizationId: string, batchId: string, lineId: string, reason: string, actor: { userId: string }) {
  return setLineStatus(organizationId, batchId, lineId, "EXCLUDED", reason, actor);
}

export async function includeAssessmentLine(organizationId: string, batchId: string, lineId: string, actor: { userId: string }) {
  return setLineStatus(organizationId, batchId, lineId, "INCLUDED", null, actor);
}

export async function cancelAssessmentBatch(organizationId: string, batchId: string, actor: { userId: string }) {
  const updated = await prisma.ptaVolunteerAssessmentBatch.updateMany({
    where: { id: batchId, organizationId, status: "DRAFT" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (updated.count === 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Only a DRAFT batch can be cancelled.");
  }
  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "pta.volunteer_hours.assessment_batch_cancelled",
    entityType: "pta_volunteer_assessment_batch",
    entityId: batchId,
  });
}

/**
 * Transactional, duplicate-post-proof: a compare-and-swap status transition
 * (DRAFT -> POSTED) on the batch guards against a second concurrent post
 * exactly like settlePendingPaymentBySession's own pattern — a lost race
 * throws rather than silently posting twice. Creates one charge + one
 * idempotent ASSESSMENT_CHARGE ledger entry per INCLUDED line; EXCLUDED
 * lines are skipped entirely (no charge, no ledger entry).
 */
export async function postAssessmentBatch(organizationId: string, batchId: string, actor: { userId: string; userEmail?: string | null }) {
  const period = await prisma.ptaVolunteerAssessmentBatch.findFirst({
    where: { id: batchId, organizationId },
    select: { requirementPeriodId: true },
  });
  if (!period) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment batch not found in this organization.");
  const requirementPeriod = await getVolunteerRequirementPeriod(organizationId, period.requirementPeriodId);

  const charges = await prisma.$transaction(async (tx) => {
    const claimed = await tx.ptaVolunteerAssessmentBatch.updateMany({
      where: { id: batchId, organizationId, status: "DRAFT" },
      data: { status: "POSTED", postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (claimed.count === 0) {
      throw new PtaError("PTA_VALIDATION_ERROR", "This batch has already been posted or cancelled.");
    }

    const includedLines = await tx.ptaVolunteerAssessmentLine.findMany({ where: { batchId, status: "INCLUDED" } });

    const created: { id: string; householdId: string; amountCents: number; lineId: string }[] = [];
    for (const line of includedLines) {
      const charge = await tx.ptaVolunteerAssessmentCharge.create({
        data: {
          organizationId,
          requirementPeriodId: period.requirementPeriodId,
          householdId: line.householdId,
          batchId,
          lineId: line.id,
          amountCents: line.assessmentCents,
          dueDate: requirementPeriod.assessmentPaymentDueDate,
        },
      });
      await tx.ptaVolunteerAssessmentLine.update({ where: { id: line.id }, data: { status: "POSTED" } });
      created.push({ id: charge.id, householdId: line.householdId, amountCents: line.assessmentCents, lineId: line.id });
    }
    return created;
  });

  for (const charge of charges) {
    await postLedgerEntry({
      organizationId,
      requirementPeriodId: period.requirementPeriodId,
      householdId: charge.householdId,
      entryType: "ASSESSMENT_CHARGE",
      amountCents: charge.amountCents,
      approvalStatus: "APPROVED",
      sourceType: "assessmentLine",
      sourceId: charge.lineId,
      description: "Remaining-hours assessment",
    });
  }

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.assessment_batch_posted",
    entityType: "pta_volunteer_assessment_batch",
    entityId: batchId,
    metadata: { chargeCount: charges.length, totalCents: charges.reduce((sum, c) => sum + c.amountCents, 0) },
  });

  return charges;
}

/** The caller's OWN household's assessment charges — householdId is always
 * server-resolved from requirePtaHouseholdSelfAccess, never a client
 * parameter (see the /my-household/assessments route). */
export async function listHouseholdAssessmentCharges(organizationId: string, householdId: string) {
  return prisma.ptaVolunteerAssessmentCharge.findMany({ where: { organizationId, householdId }, orderBy: { createdAt: "desc" } });
}
