import { resolveVolunteerBuyoutRate } from "../pricing";
import { getVolunteerRequirementPeriod } from "../periods";
import { buildHouseholdReportContexts, buildReportInfo, emptySummaryTotals, STANDARD_CALCULATION_NOTES } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

export type ComplianceFilter =
  | "MET"
  | "NOT_MET"
  | "NO_HOURS"
  | "PENDING"
  | "ELIGIBLE_FOR_BUYOUT"
  | "SUBJECT_TO_ASSESSMENT"
  | "EXEMPT";

export interface ComplianceRow {
  householdId: string;
  householdDisplayName: string;
  adjustedRequiredMinutes: number;
  verifiedMinutes: number;
  purchasedMinutes: number;
  waivedMinutes: number;
  remainingMinutes: number;
  completionPercent: number;
  completionStatus: "MET" | "NOT_MET" | "EXEMPT";
  volunteerDeadline: Date | null;
  daysRemainingOrOverdue: number | null;
  estimatedFinalAssessmentCents: number | null;
  exemptionOrAdjustmentIndicator: string | null;
}

/** Report D: Volunteer Requirement Compliance Report (spec §11) — reuses
 * the identical per-household context Report A does, adding a
 * deadline-countdown and an estimate of what a not-yet-posted assessment
 * would charge at the currently active FINAL_ASSESSMENT rate (a live
 * estimate only — never what actually posts, which VH-G's own preview
 * computes and snapshots independently at post time). */
export async function buildComplianceReportData(
  organizationId: string,
  filters: VolunteerReportFilters & { complianceFilter?: ComplianceFilter },
  generatedByName: string
): Promise<ReportData<ComplianceRow>> {
  const period = await getVolunteerRequirementPeriod(organizationId, filters.requirementPeriodId);
  const finalAssessmentWindow = await resolveVolunteerBuyoutRate(organizationId, filters.requirementPeriodId, "FINAL_ASSESSMENT");
  const contexts = await buildHouseholdReportContexts(organizationId, filters);

  const now = Date.now();
  const rows: ComplianceRow[] = [];
  for (const ctx of contexts) {
    const completionStatus: ComplianceRow["completionStatus"] = ctx.requirement.exempt ? "EXEMPT" : ctx.remainingMinutes === 0 ? "MET" : "NOT_MET";

    let complianceMatch = true;
    switch (filters.complianceFilter) {
      case "MET":
        complianceMatch = completionStatus === "MET";
        break;
      case "NOT_MET":
        complianceMatch = completionStatus === "NOT_MET";
        break;
      case "EXEMPT":
        complianceMatch = completionStatus === "EXEMPT";
        break;
      case "NO_HOURS":
        complianceMatch = ctx.totals.verifiedMinutes === 0 && ctx.totals.purchasedMinutes === 0;
        break;
      case "PENDING":
        complianceMatch = ctx.totals.pendingMinutes > 0;
        break;
      case "ELIGIBLE_FOR_BUYOUT":
        complianceMatch = completionStatus === "NOT_MET";
        break;
      case "SUBJECT_TO_ASSESSMENT":
        complianceMatch = completionStatus === "NOT_MET" && Boolean(finalAssessmentWindow);
        break;
      default:
        complianceMatch = true;
    }
    if (!complianceMatch) continue;

    const daysRemainingOrOverdue = period.volunteerDeadline ? Math.round((period.volunteerDeadline.getTime() - now) / (1000 * 60 * 60 * 24)) : null;
    const estimatedFinalAssessmentCents =
      completionStatus === "NOT_MET" && finalAssessmentWindow ? Math.round((ctx.remainingMinutes / 60) * finalAssessmentWindow.amountCents) : null;

    rows.push({
      householdId: ctx.householdId,
      householdDisplayName: ctx.householdDisplayName,
      adjustedRequiredMinutes: ctx.requirement.requiredMinutes,
      verifiedMinutes: ctx.totals.verifiedMinutes,
      purchasedMinutes: ctx.totals.purchasedMinutes,
      waivedMinutes: ctx.totals.waivedMinutes,
      remainingMinutes: ctx.remainingMinutes,
      completionPercent:
        ctx.requirement.requiredMinutes > 0
          ? Math.min(100, Math.round(((ctx.totals.verifiedMinutes + ctx.totals.purchasedMinutes + ctx.totals.creditMinutes + ctx.totals.waivedMinutes) / ctx.requirement.requiredMinutes) * 100))
          : 100,
      completionStatus,
      volunteerDeadline: period.volunteerDeadline,
      daysRemainingOrOverdue,
      estimatedFinalAssessmentCents,
      exemptionOrAdjustmentIndicator: ctx.requirement.assignmentType !== "STANDARD" ? ctx.requirement.reason : null,
    });
  }

  const summary = emptySummaryTotals();
  summary.totalFamilies = rows.length;
  for (const row of rows) {
    summary.totalVerifiedMinutes += row.verifiedMinutes;
    summary.totalPurchasedMinutes += row.purchasedMinutes;
    summary.totalWaivedMinutes += row.waivedMinutes;
    summary.totalRemainingMinutes += row.remainingMinutes;
    summary.totalAssessmentsCents += row.estimatedFinalAssessmentCents ?? 0;
    if (row.completionStatus === "MET") summary.familiesMeetingRequirement += 1;
    else if (row.completionStatus === "EXEMPT") summary.familiesExempt += 1;
    else summary.familiesNotMeetingRequirement += 1;
  }

  const info = await buildReportInfo(organizationId, filters, "Volunteer Requirement Compliance Report", generatedByName, [
    ...STANDARD_CALCULATION_NOTES,
    "Estimated final assessment uses the currently active rate and is a live estimate only — it is not a posted charge and may differ from what an actual assessment batch computes at post time.",
  ]);
  return { info, summary, rows };
}

export const COMPLIANCE_COLUMNS: ReportColumn<ComplianceRow>[] = [
  { header: "Family", format: "text", width: 24, getValue: (r) => r.householdDisplayName },
  { header: "Adjusted required (h)", format: "hours", width: 14, getValue: (r) => r.adjustedRequiredMinutes },
  { header: "Verified (h)", format: "hours", width: 12, getValue: (r) => r.verifiedMinutes },
  { header: "Purchased (h)", format: "hours", width: 12, getValue: (r) => r.purchasedMinutes },
  { header: "Waived (h)", format: "hours", width: 12, getValue: (r) => r.waivedMinutes },
  { header: "Remaining (h)", format: "hours", width: 12, getValue: (r) => r.remainingMinutes },
  { header: "Completion %", format: "percent", width: 12, getValue: (r) => r.completionPercent },
  { header: "Status", format: "text", width: 12, getValue: (r) => r.completionStatus },
  { header: "Volunteer deadline", format: "date", width: 14, getValue: (r) => r.volunteerDeadline },
  { header: "Days remaining/overdue", format: "integer", width: 16, getValue: (r) => r.daysRemainingOrOverdue },
  { header: "Est. final assessment", format: "currency", width: 16, getValue: (r) => r.estimatedFinalAssessmentCents },
  { header: "Exemption / adjustment", format: "text", width: 24, getValue: (r) => r.exemptionOrAdjustmentIndicator },
];
