import { prisma } from "@/lib/prisma";
import { getVolunteerRequirementPeriod } from "../periods";
import { buildHouseholdReportContexts, buildReportInfo, emptySummaryTotals, STANDARD_CALCULATION_NOTES } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

export type FamilyRequirementStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "MET_SERVICE"
  | "MET_BUYOUT"
  | "MET_COMBINED"
  | "EXEMPT"
  | "OVERDUE"
  | "ASSESSMENT_DUE"
  | "ASSESSMENT_PAID";

export interface FamilySummaryRow {
  householdId: string;
  householdDisplayName: string;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  studentNames: string;
  membershipStatus: string;
  originalRequiredMinutes: number;
  adjustedRequiredMinutes: number;
  verifiedMinutes: number;
  eventMinutes: number;
  nonEventMinutes: number;
  pendingMinutes: number;
  rejectedMinutes: number;
  purchasedMinutes: number;
  creditMinutes: number;
  waivedMinutes: number;
  remainingMinutes: number;
  completionPercent: number;
  requirementStatus: FamilyRequirementStatus;
  buyoutAmountPaidCents: number;
  assessmentAmountCents: number;
  outstandingBalanceCents: number;
  paymentStatus: string;
  lastVolunteerDate: Date | null;
  noteOrExceptionIndicator: string | null;
}

/**
 * Report A: Family Volunteer Summary — one row per family (spec §11).
 * Shares the exact per-household computation every other report in this
 * program uses (buildHouseholdReportContexts), so this report's totals can
 * never diverge from what the family sees on their own dashboard or what
 * VH-G's assessment batch charges.
 */
export async function buildFamilySummaryReportData(
  organizationId: string,
  filters: VolunteerReportFilters,
  generatedByName: string
): Promise<ReportData<FamilySummaryRow>> {
  const period = await getVolunteerRequirementPeriod(organizationId, filters.requirementPeriodId);
  const contexts = await buildHouseholdReportContexts(organizationId, filters);

  const rows: FamilySummaryRow[] = [];
  for (const ctx of contexts) {
    const [household, students, purchases, charges, lastVerified] = await Promise.all([
      prisma.ptaHousehold.findUnique({
        where: { id: ctx.householdId },
        select: { primaryContact: { select: { name: true, email: true } } },
      }),
      prisma.ptaStudent.findMany({ where: { organizationId, householdId: ctx.householdId }, select: { displayName: true } }),
      prisma.ptaVolunteerBuyoutPurchase.findMany({
        where: { organizationId, requirementPeriodId: filters.requirementPeriodId, householdId: ctx.householdId, status: { in: ["COMPLETED", "REFUNDED"] } },
        select: { baseAmountCents: true, coverageAmountCents: true, refundedAmountCents: true },
      }),
      prisma.ptaVolunteerAssessmentCharge.findMany({
        where: { organizationId, requirementPeriodId: filters.requirementPeriodId, householdId: ctx.householdId },
        select: { amountCents: true, amountPaidCents: true, status: true },
      }),
      prisma.ptaVolunteerLedgerEntry.findFirst({
        where: {
          organizationId,
          requirementPeriodId: filters.requirementPeriodId,
          householdId: ctx.householdId,
          entryType: { in: ["SERVICE_VERIFIED", "CORRECTED"] },
          approvalStatus: "APPROVED",
        },
        orderBy: { effectiveDate: "desc" },
        select: { effectiveDate: true },
      }),
    ]);

    const buyoutAmountPaidCents = purchases.reduce((sum, p) => sum + p.baseAmountCents + p.coverageAmountCents - p.refundedAmountCents, 0);
    const assessmentAmountCents = charges.reduce((sum, c) => sum + c.amountCents, 0);
    const outstandingAssessmentCents = charges.reduce((sum, c) => sum + Math.max(0, c.amountCents - c.amountPaidCents), 0);
    const hasPendingAssessment = charges.some((c) => c.status === "PENDING" || c.status === "PARTIAL");
    const hasPaidAssessment = charges.length > 0 && charges.every((c) => c.status === "PAID");

    let requirementStatus: FamilyRequirementStatus;
    if (ctx.requirement.exempt) {
      requirementStatus = "EXEMPT";
    } else if (ctx.remainingMinutes === 0) {
      if (ctx.totals.purchasedMinutes > 0 && ctx.totals.verifiedMinutes > 0) requirementStatus = "MET_COMBINED";
      else if (ctx.totals.purchasedMinutes > 0) requirementStatus = "MET_BUYOUT";
      else requirementStatus = "MET_SERVICE";
    } else if (hasPendingAssessment) {
      requirementStatus = "ASSESSMENT_DUE";
    } else if (hasPaidAssessment) {
      requirementStatus = "ASSESSMENT_PAID";
    } else if (period.volunteerDeadline && period.volunteerDeadline.getTime() < Date.now()) {
      requirementStatus = "OVERDUE";
    } else if (ctx.totals.verifiedMinutes === 0 && ctx.totals.purchasedMinutes === 0) {
      requirementStatus = "NOT_STARTED";
    } else {
      requirementStatus = "IN_PROGRESS";
    }

    if (filters.requirementStatus && filters.requirementStatus !== requirementStatus) continue;

    rows.push({
      householdId: ctx.householdId,
      householdDisplayName: ctx.householdDisplayName,
      primaryContactName: household?.primaryContact?.name ?? null,
      primaryContactEmail: household?.primaryContact?.email ?? null,
      studentNames: students.map((s) => s.displayName).join(", "),
      membershipStatus: ctx.householdStatus,
      originalRequiredMinutes: period.requiredMinutesDefault,
      adjustedRequiredMinutes: ctx.requirement.requiredMinutes,
      verifiedMinutes: ctx.totals.verifiedMinutes,
      eventMinutes: ctx.totals.eventMinutes,
      nonEventMinutes: ctx.totals.nonEventMinutes,
      pendingMinutes: ctx.totals.pendingMinutes,
      rejectedMinutes: ctx.totals.rejectedMinutes,
      purchasedMinutes: ctx.totals.purchasedMinutes,
      creditMinutes: ctx.totals.creditMinutes,
      waivedMinutes: ctx.totals.waivedMinutes,
      remainingMinutes: ctx.remainingMinutes,
      completionPercent:
        ctx.requirement.requiredMinutes > 0
          ? Math.min(100, Math.round(((ctx.totals.verifiedMinutes + ctx.totals.purchasedMinutes + ctx.totals.creditMinutes + ctx.totals.waivedMinutes) / ctx.requirement.requiredMinutes) * 100))
          : 100,
      requirementStatus,
      buyoutAmountPaidCents,
      assessmentAmountCents,
      outstandingBalanceCents: outstandingAssessmentCents,
      paymentStatus: outstandingAssessmentCents > 0 ? "Balance due" : assessmentAmountCents > 0 ? "Paid in full" : "No assessment",
      lastVolunteerDate: lastVerified?.effectiveDate ?? null,
      noteOrExceptionIndicator: ctx.requirement.reason,
    });
  }

  const summary = emptySummaryTotals();
  summary.totalFamilies = rows.length;
  for (const row of rows) {
    summary.totalVerifiedMinutes += row.verifiedMinutes;
    summary.totalEventMinutes += row.eventMinutes;
    summary.totalNonEventMinutes += row.nonEventMinutes;
    summary.totalPendingMinutes += row.pendingMinutes;
    summary.totalPurchasedMinutes += row.purchasedMinutes;
    summary.totalWaivedMinutes += row.waivedMinutes;
    summary.totalRemainingMinutes += row.remainingMinutes;
    summary.totalBuyoutRevenueCents += row.buyoutAmountPaidCents;
    summary.totalAssessmentsCents += row.assessmentAmountCents;
    summary.outstandingBalanceCents += row.outstandingBalanceCents;
    if (row.requirementStatus === "EXEMPT") summary.familiesExempt += 1;
    else if (row.requirementStatus.startsWith("MET_")) summary.familiesMeetingRequirement += 1;
    else summary.familiesNotMeetingRequirement += 1;
  }

  const info = await buildReportInfo(organizationId, filters, "Family Volunteer Summary", generatedByName, STANDARD_CALCULATION_NOTES);
  return { info, summary, rows };
}

export const FAMILY_SUMMARY_COLUMNS: ReportColumn<FamilySummaryRow>[] = [
  { header: "Family", format: "text", width: 24, getValue: (r) => r.householdDisplayName },
  { header: "Primary contact", format: "text", width: 20, getValue: (r) => r.primaryContactName },
  { header: "Primary email", format: "text", width: 24, getValue: (r) => r.primaryContactEmail },
  { header: "Students", format: "text", width: 24, getValue: (r) => r.studentNames },
  { header: "Membership status", format: "text", width: 16, getValue: (r) => r.membershipStatus },
  { header: "Original required (h)", format: "hours", width: 14, getValue: (r) => r.originalRequiredMinutes },
  { header: "Adjusted required (h)", format: "hours", width: 14, getValue: (r) => r.adjustedRequiredMinutes },
  { header: "Verified (h)", format: "hours", width: 12, getValue: (r) => r.verifiedMinutes },
  { header: "Event (h)", format: "hours", width: 12, getValue: (r) => r.eventMinutes },
  { header: "Non-event (h)", format: "hours", width: 12, getValue: (r) => r.nonEventMinutes },
  { header: "Pending (h)", format: "hours", width: 12, getValue: (r) => r.pendingMinutes },
  { header: "Rejected (h)", format: "hours", width: 12, getValue: (r) => r.rejectedMinutes },
  { header: "Purchased (h)", format: "hours", width: 12, getValue: (r) => r.purchasedMinutes },
  { header: "Admin credit (h)", format: "hours", width: 14, getValue: (r) => r.creditMinutes },
  { header: "Waived (h)", format: "hours", width: 12, getValue: (r) => r.waivedMinutes },
  { header: "Remaining (h)", format: "hours", width: 12, getValue: (r) => r.remainingMinutes },
  { header: "Completion %", format: "percent", width: 12, getValue: (r) => r.completionPercent },
  { header: "Requirement status", format: "text", width: 18, getValue: (r) => r.requirementStatus },
  { header: "Buyout paid", format: "currency", width: 12, getValue: (r) => r.buyoutAmountPaidCents },
  { header: "Assessment", format: "currency", width: 12, getValue: (r) => r.assessmentAmountCents },
  { header: "Outstanding balance", format: "currency", width: 14, getValue: (r) => r.outstandingBalanceCents },
  { header: "Payment status", format: "text", width: 14, getValue: (r) => r.paymentStatus },
  { header: "Last volunteer date", format: "date", width: 14, getValue: (r) => r.lastVolunteerDate },
  { header: "Notes / exception", format: "text", width: 24, getValue: (r) => r.noteOrExceptionIndicator },
];
