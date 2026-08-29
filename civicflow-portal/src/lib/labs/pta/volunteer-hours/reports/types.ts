/**
 * Volunteer Hours Reporting Center, VH-J/K (docs/pta-volunteer-hours.md,
 * spec §11-14). Every report module exports one build*Data(organizationId,
 * filters) function returning this shape — consumed identically by the
 * on-screen JSON API and the exceljs workbook builder, so the two can never
 * diverge (spec §14: "the displayed report and downloaded spreadsheet must
 * use the same server-side report query").
 *
 * Filter coverage is honest about this codebase's real data model: period,
 * date range, household, approval status, and volunteer category are fully
 * supported. Grade/classroom filtering reuses VH-B's own scope-matching
 * (current-year enrollment). Campus and membership-type filters are NOT
 * implemented — no formal campus/program entity exists anywhere in this
 * schema (the same gap already documented for VH-A's period scopeLabel and
 * VH-B's PROGRAM scope type), and "membership type" has no dedicated model
 * beyond the Category a household's DuesAccount happens to reference.
 */
/**
 * PERIOD (default, always used unless explicitly overridden) — activity is
 * restricted to the selected requirement period via an unambiguous,
 * documented relationship (the PtaVolunteerLedgerEntry mirror that already
 * records which period a raw hour entry was actually processed under).
 * ALL_TIME — explicit opt-in only, never the default when a period ID is
 * supplied; shows a household's/org's full historical activity across every
 * period (or no period at all), clearly labeled as such. See
 * docs/pta-volunteer-hours-report-period-scope-fix.md.
 */
export type VolunteerReportMode = "PERIOD" | "ALL_TIME";

export interface VolunteerReportFilters {
  requirementPeriodId: string;
  mode?: VolunteerReportMode;
  dateRangeStart?: Date;
  dateRangeEnd?: Date;
  householdId?: string;
  householdAdultId?: string;
  gradeId?: string;
  classroomId?: string;
  eventId?: string;
  volunteerCategory?: string;
  approvalStatus?: "PENDING" | "APPROVED" | "REJECTED";
  requirementStatus?: string;
  paymentStatus?: string;
}

export interface ReportInfoMeta {
  organizationName: string;
  reportTitle: string;
  requirementPeriodName: string;
  coveredDateRange: string;
  appliedFilters: Record<string, string>;
  generatedAt: Date;
  organizationTimezone: string;
  generatedByName: string;
  calculationNotes: string[];
}

export interface ReportSummaryTotals {
  totalFamilies: number;
  totalIndividualVolunteers: number;
  totalVerifiedMinutes: number;
  totalEventMinutes: number;
  totalNonEventMinutes: number;
  totalPendingMinutes: number;
  totalPurchasedMinutes: number;
  totalWaivedMinutes: number;
  totalRemainingMinutes: number;
  familiesMeetingRequirement: number;
  familiesNotMeetingRequirement: number;
  familiesExempt: number;
  totalBuyoutRevenueCents: number;
  totalAssessmentsCents: number;
  outstandingBalanceCents: number;
}

export interface ReportData<Row> {
  info: ReportInfoMeta;
  summary: ReportSummaryTotals;
  rows: Row[];
}
