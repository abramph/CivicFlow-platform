import { PERMISSIONS, type Permission } from "@/lib/rbac";
import { buildComplianceReportData, getComplianceColumns, type ComplianceFilter } from "./compliance";
import { buildDetailActivityReportData, DETAIL_ACTIVITY_COLUMNS } from "./detail-activity";
import { buildEventHoursReportData, EVENT_HOURS_COLUMNS } from "./event-hours";
import { buildFamilySummaryReportData, getFamilySummaryColumns } from "./family-summary";
import { buildFinancialReportData, FINANCIAL_COLUMNS } from "./financial";
import { buildIndividualVolunteerReportData, INDIVIDUAL_VOLUNTEER_COLUMNS } from "./individual-volunteer";
import type { VolunteerReportFilters } from "./types";
import { buildVolunteerCategoryReportData, VOLUNTEER_CATEGORY_COLUMNS } from "./volunteer-category";
import { buildReportFilename, buildVolunteerReportWorkbook } from "./xlsx-builder";

export const VOLUNTEER_REPORT_TYPES = [
  "PTA_VOLUNTEER_FAMILY_SUMMARY",
  "PTA_VOLUNTEER_DETAIL_ACTIVITY",
  "PTA_VOLUNTEER_EVENT_HOURS",
  "PTA_VOLUNTEER_COMPLIANCE",
  "PTA_VOLUNTEER_FINANCIAL",
  "PTA_VOLUNTEER_INDIVIDUAL",
  "PTA_VOLUNTEER_CATEGORY",
] as const;

export type VolunteerReportType = (typeof VOLUNTEER_REPORT_TYPES)[number];

const TYPE_SET = new Set<string>(VOLUNTEER_REPORT_TYPES);

/** Every ReportExport row this program's background worker will ever be
 * asked to process carries one of these type strings — anything else is
 * some other vertical's export and must be left to the generic CSV path
 * in src/lib/reports.ts untouched. */
export function isVolunteerReportType(value: string): value is VolunteerReportType {
  return TYPE_SET.has(value);
}

/** Report E is the one report in this program gated on the stricter
 * financial-reports permission (spec: money-sensitive, unlike A-D/F/G's
 * general reports permission) — mirrors the JSON/export route gating
 * decided in VH-J and applied here for the queue/status/download routes. */
export function permissionForVolunteerReportType(reportType: VolunteerReportType): Permission {
  return reportType === "PTA_VOLUNTEER_FINANCIAL" ? PERMISSIONS.PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW : PERMISSIONS.PTA_VOLUNTEER_REPORTS_VIEW;
}

/** One place that maps a report type to its build function + xlsx columns
 * — used by both the synchronous export routes (implicitly, via each
 * report's own route file) and the background worker (explicitly, since a
 * queued job only carries a type string, not a direct function reference). */
export async function buildVolunteerReportExportFile(
  organizationId: string,
  reportType: VolunteerReportType,
  filters: VolunteerReportFilters & { complianceFilter?: string },
  generatedByName: string,
  /** fix/pta-volunteer-financial-controls: meaningful for
   * PTA_VOLUNTEER_FAMILY_SUMMARY and PTA_VOLUNTEER_COMPLIANCE (RV-12: found
   * and fixed the same unconditional-dollar-field leak FC-3 fixed for
   * family-summary, previously present in compliance's
   * estimatedFinalAssessmentCents) — every other report type ignores it (E
   * is already fully financial-gated upstream via
   * permissionForVolunteerReportType; B/C/F/G never carried dollar amounts
   * in the first place). The caller (the background worker) is responsible
   * for re-deriving this fresh from the export's creator's CURRENT
   * permissions — see reports.ts. */
  includeFinancials = false
): Promise<{ buffer: Buffer; filename: string }> {
  const info = { data: undefined as { organizationName: string; reportTitle: string; requirementPeriodName: string } | undefined };
  let buffer: Buffer;

  switch (reportType) {
    case "PTA_VOLUNTEER_FAMILY_SUMMARY": {
      const data = await buildFamilySummaryReportData(organizationId, filters, generatedByName, includeFinancials);
      buffer = await buildVolunteerReportWorkbook(data, getFamilySummaryColumns(includeFinancials));
      info.data = data.info;
      break;
    }
    case "PTA_VOLUNTEER_DETAIL_ACTIVITY": {
      const data = await buildDetailActivityReportData(organizationId, filters, generatedByName);
      buffer = await buildVolunteerReportWorkbook(data, DETAIL_ACTIVITY_COLUMNS);
      info.data = data.info;
      break;
    }
    case "PTA_VOLUNTEER_EVENT_HOURS": {
      const data = await buildEventHoursReportData(organizationId, filters, generatedByName);
      buffer = await buildVolunteerReportWorkbook(data, EVENT_HOURS_COLUMNS);
      info.data = data.info;
      break;
    }
    case "PTA_VOLUNTEER_COMPLIANCE": {
      const data = await buildComplianceReportData(
        organizationId,
        { ...filters, complianceFilter: filters.complianceFilter as ComplianceFilter | undefined },
        generatedByName,
        includeFinancials
      );
      buffer = await buildVolunteerReportWorkbook(data, getComplianceColumns(includeFinancials));
      info.data = data.info;
      break;
    }
    case "PTA_VOLUNTEER_FINANCIAL": {
      const data = await buildFinancialReportData(organizationId, filters, generatedByName);
      buffer = await buildVolunteerReportWorkbook(data, FINANCIAL_COLUMNS);
      info.data = data.info;
      break;
    }
    case "PTA_VOLUNTEER_INDIVIDUAL": {
      const data = await buildIndividualVolunteerReportData(organizationId, filters, generatedByName);
      buffer = await buildVolunteerReportWorkbook(data, INDIVIDUAL_VOLUNTEER_COLUMNS);
      info.data = data.info;
      break;
    }
    case "PTA_VOLUNTEER_CATEGORY": {
      const data = await buildVolunteerCategoryReportData(organizationId, filters, generatedByName);
      buffer = await buildVolunteerReportWorkbook(data, VOLUNTEER_CATEGORY_COLUMNS);
      info.data = data.info;
      break;
    }
  }

  const filename = buildReportFilename(info.data!.organizationName, info.data!.reportTitle, info.data!.requirementPeriodName);
  return { buffer, filename };
}
