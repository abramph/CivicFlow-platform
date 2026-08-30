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
  /** fix/pta-volunteer-financial-controls: undefined (never a redacted "$0.00")
   * for a caller without pta:volunteer-financial-reports:view — Report A is
   * operational/nonfinancial for those callers. Only Report E, and a
   * household's own self-service copy of Report A, ever populate these.
   * `undefined` (not `null`/`0`) so JSON.stringify/Response.json omit the key
   * entirely rather than shipping a value a non-financial viewer could infer
   * meaning from — the field must be genuinely absent from the payload. */
  buyoutAmountPaidCents: number | undefined;
  assessmentAmountCents: number | undefined;
  outstandingBalanceCents: number | undefined;
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
  generatedByName: string,
  /** fix/pta-volunteer-financial-controls: must be explicitly true — callers
   * that forget this argument get the safe (nonfinancial) default rather
   * than silently regaining the leak this correction closes. Only the
   * admin JSON/export routes (gated on pta:volunteer-financial-reports:view)
   * and the household self-service routes (always the family's own data)
   * pass true. */
  includeFinancials = false
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
      // These three dollar fields are computed above unconditionally (the
      // computation feeds requirementStatus/paymentStatus, which stay
      // available to every viewer), but only ever placed on the row when the
      // caller has confirmed financial-report access — see includeFinancials
      // doc comment above. `undefined` here means the JSON key and the Excel
      // column genuinely do not exist for a non-financial viewer, not that
      // the amount is zero.
      buyoutAmountPaidCents: includeFinancials ? buyoutAmountPaidCents : undefined,
      assessmentAmountCents: includeFinancials ? assessmentAmountCents : undefined,
      outstandingBalanceCents: includeFinancials ? outstandingAssessmentCents : undefined,
      paymentStatus: outstandingAssessmentCents > 0 ? "Balance due" : assessmentAmountCents > 0 ? "Paid in full" : "No assessment",
      lastVolunteerDate: lastVerified?.effectiveDate ?? null,
      noteOrExceptionIndicator: ctx.requirement.reason,
    });
  }

  const summary = emptySummaryTotals();
  summary.totalFamilies = rows.length;
  // The three dollar summary fields start `undefined` (never a redacted
  // "$0.00") for a non-financial caller — matches emptySummaryTotals()'s
  // other callers, which still default them to 0; only this report
  // conditionally withholds them. xlsx-builder.ts skips a Summary-sheet row
  // entirely when its value is undefined, so the sheet itself never shows a
  // "Total buyout revenue"/"Total assessments"/"Outstanding balance" line
  // for a non-financial viewer, rather than showing a misleading $0.00.
  if (!includeFinancials) {
    summary.totalBuyoutRevenueCents = undefined;
    summary.totalAssessmentsCents = undefined;
    summary.outstandingBalanceCents = undefined;
  }
  for (const row of rows) {
    summary.totalVerifiedMinutes += row.verifiedMinutes;
    summary.totalEventMinutes += row.eventMinutes;
    summary.totalNonEventMinutes += row.nonEventMinutes;
    summary.totalPendingMinutes += row.pendingMinutes;
    summary.totalPurchasedMinutes += row.purchasedMinutes;
    summary.totalWaivedMinutes += row.waivedMinutes;
    summary.totalRemainingMinutes += row.remainingMinutes;
    if (includeFinancials) {
      summary.totalBuyoutRevenueCents = (summary.totalBuyoutRevenueCents ?? 0) + (row.buyoutAmountPaidCents ?? 0);
      summary.totalAssessmentsCents = (summary.totalAssessmentsCents ?? 0) + (row.assessmentAmountCents ?? 0);
      summary.outstandingBalanceCents = (summary.outstandingBalanceCents ?? 0) + (row.outstandingBalanceCents ?? 0);
    }
    if (row.requirementStatus === "EXEMPT") summary.familiesExempt += 1;
    else if (row.requirementStatus.startsWith("MET_")) summary.familiesMeetingRequirement += 1;
    else summary.familiesNotMeetingRequirement += 1;
  }

  const info = await buildReportInfo(organizationId, filters, "Family Volunteer Summary", generatedByName, STANDARD_CALCULATION_NOTES);
  return { info, summary, rows };
}

/** Operational/nonfinancial columns — every viewer with pta:volunteer-reports:view
 * gets these, admin or family. No dollar amounts. */
const FAMILY_SUMMARY_OPERATIONAL_COLUMNS: ReportColumn<FamilySummaryRow>[] = [
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
  { header: "Payment status", format: "text", width: 14, getValue: (r) => r.paymentStatus },
  { header: "Last volunteer date", format: "date", width: 14, getValue: (r) => r.lastVolunteerDate },
  { header: "Notes / exception", format: "text", width: 24, getValue: (r) => r.noteOrExceptionIndicator },
];

/** fix/pta-volunteer-financial-controls: dollar-amount columns, previously
 * always present regardless of viewer permission — the confirmed leak this
 * branch closes. Only ever appended when the caller has already confirmed
 * pta:volunteer-financial-reports:view (admin) or is the household's own
 * self-service copy — see getFamilySummaryColumns(). */
const FAMILY_SUMMARY_FINANCIAL_COLUMNS: ReportColumn<FamilySummaryRow>[] = [
  { header: "Buyout paid", format: "currency", width: 12, getValue: (r) => r.buyoutAmountPaidCents },
  { header: "Assessment", format: "currency", width: 12, getValue: (r) => r.assessmentAmountCents },
  { header: "Outstanding balance", format: "currency", width: 14, getValue: (r) => r.outstandingBalanceCents },
];

/** The xlsx/JSON column set for Report A, gated the same way the row data
 * itself is gated (buildFamilySummaryReportData's own includeFinancials) —
 * keeping both gates driven by the same boolean is what guarantees the
 * Excel dataset and the JSON payload can never disagree about whether
 * financial columns are present. */
export function getFamilySummaryColumns(includeFinancials: boolean): ReportColumn<FamilySummaryRow>[] {
  return includeFinancials
    ? [...FAMILY_SUMMARY_OPERATIONAL_COLUMNS, ...FAMILY_SUMMARY_FINANCIAL_COLUMNS]
    : FAMILY_SUMMARY_OPERATIONAL_COLUMNS;
}

/** @deprecated fix/pta-volunteer-financial-controls: use
 * getFamilySummaryColumns(includeFinancials) instead — this constant always
 * included the financial columns unconditionally, which is exactly the leak
 * this branch fixes. Kept only so any not-yet-updated caller fails loudly
 * (wrong column count / a "Buyout paid" header no admin viewer should see)
 * rather than silently; every in-repo caller has been migrated off it. */
export const FAMILY_SUMMARY_COLUMNS = getFamilySummaryColumns(true);
