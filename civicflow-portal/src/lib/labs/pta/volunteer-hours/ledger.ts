import type { Prisma, PtaVolunteerCategory, PtaVolunteerLedgerApprovalStatus, PtaVolunteerLedgerEntryType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PtaError } from "../errors";

export interface PostLedgerEntryInput {
  organizationId: string;
  requirementPeriodId: string;
  householdId: string;
  householdAdultId?: string | null;
  entryType: PtaVolunteerLedgerEntryType;
  category?: PtaVolunteerCategory | null;
  minutes?: number;
  amountCents?: number | null;
  effectiveDate?: Date;
  approvalStatus?: PtaVolunteerLedgerApprovalStatus;
  sourceType?: string | null;
  sourceId?: string | null;
  description?: string | null;
  reason?: string | null;
  createdByUserId?: string | null;
  approvedByUserId?: string | null;
  reversalOfId?: string | null;
}

const REASON_REQUIRED_TYPES: PtaVolunteerLedgerEntryType[] = ["ADMIN_CREDIT", "WAIVER", "WRITE_OFF", "CORRECTED"];

/**
 * Idempotent insert: a unique constraint on (organizationId, sourceType,
 * sourceId, entryType) guards against duplicate posting from a retried
 * approval, a re-delivered webhook (VH-F), or a re-run background job
 * (VH-G) — same insert-then-catch-P2002 discipline as
 * StripeWebhookEvent.stripeEventId. Entries with a null sourceId are exempt
 * (manual entries have no natural source record and don't need the guard).
 * Returns the newly-created row, or the pre-existing one on a duplicate —
 * callers should never distinguish the two, both mean "this is posted."
 */
export async function postLedgerEntry(input: PostLedgerEntryInput) {
  if (REASON_REQUIRED_TYPES.includes(input.entryType) && !input.reason?.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", `A reason is required for a ${input.entryType} ledger entry.`);
  }

  const data: Prisma.PtaVolunteerLedgerEntryUncheckedCreateInput = {
    organizationId: input.organizationId,
    requirementPeriodId: input.requirementPeriodId,
    householdId: input.householdId,
    householdAdultId: input.householdAdultId ?? null,
    entryType: input.entryType,
    category: input.category ?? null,
    minutes: input.minutes ?? 0,
    amountCents: input.amountCents ?? null,
    effectiveDate: input.effectiveDate ?? new Date(),
    approvalStatus: input.approvalStatus ?? "APPROVED",
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    description: input.description ?? null,
    reason: input.reason?.trim() || null,
    createdByUserId: input.createdByUserId ?? null,
    approvedByUserId: input.approvedByUserId ?? null,
    reversalOfId: input.reversalOfId ?? null,
  };

  try {
    return await prisma.ptaVolunteerLedgerEntry.create({ data });
  } catch (error) {
    if (
      input.sourceId &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      const existing = await prisma.ptaVolunteerLedgerEntry.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId,
          entryType: input.entryType,
        },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

export interface HouseholdLedgerTotals {
  verifiedMinutes: number;
  eventMinutes: number;
  nonEventMinutes: number;
  pendingMinutes: number;
  rejectedMinutes: number;
  purchasedMinutes: number;
  creditMinutes: number;
  waivedMinutes: number;
  assessmentChargeCents: number;
  paidElectronicCents: number;
  paidOfflineCents: number;
  refundedCents: number;
  writtenOffCents: number;
  outstandingBalanceCents: number;
}

/**
 * Pending/rejected entries are NEVER folded into verifiedMinutes — only
 * APPROVED SERVICE_VERIFIED + APPROVED CORRECTED entries count (spec §10/§14:
 * "pending hours are not counted as verified," "pending hours do not reduce
 * the remaining requirement until approved"). eventMinutes is verified
 * minutes categorized EVENT_SERVICE; nonEventMinutes is every other verified
 * minute (including uncategorized, which is treated as non-event since it
 * was never explicitly tied to an event).
 */
export async function getHouseholdLedgerTotals(
  organizationId: string,
  requirementPeriodId: string,
  householdId: string
): Promise<HouseholdLedgerTotals> {
  const entries = await prisma.ptaVolunteerLedgerEntry.findMany({
    where: { organizationId, requirementPeriodId, householdId },
  });

  const totals: HouseholdLedgerTotals = {
    verifiedMinutes: 0,
    eventMinutes: 0,
    nonEventMinutes: 0,
    pendingMinutes: 0,
    rejectedMinutes: 0,
    purchasedMinutes: 0,
    creditMinutes: 0,
    waivedMinutes: 0,
    assessmentChargeCents: 0,
    paidElectronicCents: 0,
    paidOfflineCents: 0,
    refundedCents: 0,
    writtenOffCents: 0,
    outstandingBalanceCents: 0,
  };

  for (const entry of entries) {
    const minutes = entry.minutes;
    const cents = entry.amountCents ?? 0;

    if (entry.entryType === "SERVICE_VERIFIED" || entry.entryType === "CORRECTED") {
      if (entry.approvalStatus === "PENDING") {
        totals.pendingMinutes += minutes;
        continue;
      }
      if (entry.approvalStatus === "REJECTED") {
        totals.rejectedMinutes += minutes;
        continue;
      }
      if (entry.approvalStatus === "APPROVED") {
        totals.verifiedMinutes += minutes;
        if (entry.category === "EVENT_SERVICE") totals.eventMinutes += minutes;
        else totals.nonEventMinutes += minutes;
      }
      continue;
    }
    if (entry.entryType === "PURCHASE") {
      totals.purchasedMinutes += minutes;
      continue;
    }
    if (entry.entryType === "PURCHASE_REFUND") {
      totals.purchasedMinutes -= minutes;
      continue;
    }
    if (entry.entryType === "ADMIN_CREDIT") {
      totals.creditMinutes += minutes;
      continue;
    }
    if (entry.entryType === "WAIVER") {
      totals.waivedMinutes += minutes;
      continue;
    }
    if (entry.entryType === "ASSESSMENT_CHARGE") {
      totals.assessmentChargeCents += cents;
      continue;
    }
    if (entry.entryType === "PAYMENT_ELECTRONIC") {
      totals.paidElectronicCents += cents;
      continue;
    }
    if (entry.entryType === "PAYMENT_OFFLINE") {
      totals.paidOfflineCents += cents;
      continue;
    }
    if (entry.entryType === "REFUND") {
      totals.refundedCents += cents;
      continue;
    }
    if (entry.entryType === "WRITE_OFF") {
      totals.writtenOffCents += cents;
      continue;
    }
    // REQUIREMENT_CHANGE — audit trail only, no minutes/amount contribution.
  }

  totals.purchasedMinutes = Math.max(0, totals.purchasedMinutes);
  totals.outstandingBalanceCents = Math.max(
    0,
    totals.assessmentChargeCents - totals.paidElectronicCents - totals.paidOfflineCents - totals.refundedCents - totals.writtenOffCents
  );

  return totals;
}

// ─── Wiring: mirror the existing raw hour-entry lifecycle into the ledger ──

/** The single active period whose date range contains `at` — the general,
 * period-type-agnostic mapping from "when did this happen" to "which
 * period does it belong to." Returns null when no period is active for
 * that instant (e.g. the org hasn't set up VH-A yet, or is between
 * periods) — callers must treat that as "nothing to mirror," never guess. */
async function findApplicablePeriod(organizationId: string, at: Date) {
  return prisma.ptaVolunteerRequirementPeriod.findFirst({
    where: { organizationId, status: "ACTIVE", startsOn: { lte: at }, endsOn: { gt: at } },
    orderBy: { startsOn: "desc" },
  });
}

/** Called from approvePtaVolunteerHourEntry (volunteers.ts) after the raw
 * entry is updated. Best-effort and additive: if the feature isn't enabled,
 * the household has no denormalized householdId (legacy rows), or no period
 * is currently active, this is a silent no-op — the raw hour-entry approval
 * itself has already fully succeeded regardless. */
export async function mirrorHourEntryApprovalToLedger(
  organizationId: string,
  hourEntry: {
    id: string;
    householdId: string | null;
    householdAdultId: string;
    creditedMinutes: number;
    category: PtaVolunteerCategory | null;
    opportunityId: string;
    approvedByUserId: string | null;
  }
) {
  if (!hourEntry.householdId) return null;

  const period = await findApplicablePeriod(organizationId, new Date());
  if (!period) return null;

  const opportunity = await prisma.ptaVolunteerOpportunity.findUnique({
    where: { id: hourEntry.opportunityId },
    select: { eventId: true },
  });
  const category: PtaVolunteerCategory = hourEntry.category ?? (opportunity?.eventId ? "EVENT_SERVICE" : "OTHER_APPROVED_SERVICE");

  return postLedgerEntry({
    organizationId,
    requirementPeriodId: period.id,
    householdId: hourEntry.householdId,
    householdAdultId: hourEntry.householdAdultId,
    entryType: "SERVICE_VERIFIED",
    category,
    minutes: hourEntry.creditedMinutes,
    approvalStatus: "APPROVED",
    sourceType: "hourEntry",
    sourceId: hourEntry.id,
    createdByUserId: hourEntry.approvedByUserId,
    approvedByUserId: hourEntry.approvedByUserId,
  });
}

/** Called from adjustPtaVolunteerHourEntry after the PtaVolunteerHourAdjustment
 * row is created. Signed minutes, mirroring the raw adjustment exactly. */
export async function mirrorHourEntryAdjustmentToLedger(
  organizationId: string,
  adjustment: { id: string; minuteAdjustment: number; reason: string; actorUserId: string | null },
  hourEntry: { householdId: string | null; householdAdultId: string; category: PtaVolunteerCategory | null }
) {
  if (!hourEntry.householdId) return null;

  const period = await findApplicablePeriod(organizationId, new Date());
  if (!period) return null;

  return postLedgerEntry({
    organizationId,
    requirementPeriodId: period.id,
    householdId: hourEntry.householdId,
    householdAdultId: hourEntry.householdAdultId,
    entryType: "CORRECTED",
    category: hourEntry.category,
    minutes: adjustment.minuteAdjustment,
    approvalStatus: "APPROVED",
    sourceType: "hourEntryAdjustment",
    sourceId: adjustment.id,
    reason: adjustment.reason,
    createdByUserId: adjustment.actorUserId,
  });
}
