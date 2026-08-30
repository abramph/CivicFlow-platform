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
  /** RV-12: undefined (never a redacted null/0) for a caller without
   * pta:volunteer-financial-reports:view — this is a real dollar estimate,
   * not an hours figure, and this report's route was only ever gated on
   * the general pta:volunteer-reports:view permission (STAFF/READ_ONLY
   * both hold it), unlike Report E's dedicated financial-permission gate.
   * `null` still means its ordinary business meaning (not applicable —
   * MET/EXEMPT, or no FINAL_ASSESSMENT rate configured) for a caller who
   * DOES have financial access. */
  estimatedFinalAssessmentCents: number | null | undefined;
  exemptionOrAdjustmentIndicator: string | null;
}

/** Report D: Volunteer Requirement Compliance Report (spec §11) — reuses
 * the identical per-household context Report A does, adding a
 * deadline-countdown and an estimate of what a not-yet-posted assessment
 * would charge at the currently active FINAL_ASSESSMENT rate (a live
 * estimate only — never what actually posts, which VH-G's own preview
 * computes and snapshots independently at post time).
 *
 * RV-12: `includeFinancials` follows the identical contract Report A's
 * builder established (`family-summary.ts`) — must be explicitly `true`;
 * callers that omit it get the safe (nonfinancial) default. This report's
 * only dollar figure, `estimatedFinalAssessmentCents`, was previously
 * computed and returned unconditionally regardless of the caller's
 * permission — a real financial-data leak to any STAFF/READ_ONLY caller,
 * found during RV-12's re-verification and fixed here the same way FC-3
 * fixed Report A's leak.
 */
export async function buildComplianceReportData(
  organizationId: string,
  filters: VolunteerReportFilters & { complianceFilter?: ComplianceFilter },
  generatedByName: string,
  includeFinancials = false
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
    const rawEstimatedFinalAssessmentCents =
      completionStatus === "NOT_MET" && finalAssessmentWindow ? Math.round((ctx.remainingMinutes / 60) * finalAssessmentWindow.amountCents) : null;
    // RV-12: the field genuinely does not exist for a non-financial viewer
    // (undefined, dropped by JSON.stringify), not that it happens to be
    // null/0 — mirrors family-summary.ts's identical discipline.
    const estimatedFinalAssessmentCents = includeFinancials ? rawEstimatedFinalAssessmentCents : undefined;

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
  // RV-12: undefined (never a redacted "$0.00") for a non-financial caller
  // — mirrors family-summary.ts's identical discipline exactly.
  if (!includeFinancials) {
    summary.totalAssessmentsCents = undefined;
  }
  for (const row of rows) {
    summary.totalVerifiedMinutes += row.verifiedMinutes;
    summary.totalPurchasedMinutes += row.purchasedMinutes;
    summary.totalWaivedMinutes += row.waivedMinutes;
    summary.totalRemainingMinutes += row.remainingMinutes;
    if (includeFinancials) {
      summary.totalAssessmentsCents = (summary.totalAssessmentsCents ?? 0) + (row.estimatedFinalAssessmentCents ?? 0);
    }
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

const COMPLIANCE_OPERATIONAL_COLUMNS: ReportColumn<ComplianceRow>[] = [
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
  { header: "Exemption / adjustment", format: "text", width: 24, getValue: (r) => r.exemptionOrAdjustmentIndicator },
];

/** RV-12: the one dollar column, split out exactly like
 * family-summary.ts's FAMILY_SUMMARY_FINANCIAL_COLUMNS — a non-financial
 * viewer's workbook omits this column entirely (never shows it blank),
 * matching the row data itself already being `undefined` for them. */
const COMPLIANCE_FINANCIAL_COLUMNS: ReportColumn<ComplianceRow>[] = [
  { header: "Est. final assessment", format: "currency", width: 16, getValue: (r) => r.estimatedFinalAssessmentCents },
];

/** @deprecated RV-12: use getComplianceColumns(includeFinancials) instead —
 * this constant always included the financial column unconditionally,
 * which is exactly the leak this correction fixes. No remaining callers in
 * this codebase; kept only until any external reference is confirmed gone. */
export const COMPLIANCE_COLUMNS: ReportColumn<ComplianceRow>[] = [...COMPLIANCE_OPERATIONAL_COLUMNS, ...COMPLIANCE_FINANCIAL_COLUMNS];

export function getComplianceColumns(includeFinancials: boolean): ReportColumn<ComplianceRow>[] {
  return includeFinancials
    ? [...COMPLIANCE_OPERATIONAL_COLUMNS, ...COMPLIANCE_FINANCIAL_COLUMNS]
    : COMPLIANCE_OPERATIONAL_COLUMNS;
}
