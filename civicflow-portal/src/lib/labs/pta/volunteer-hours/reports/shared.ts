import { prisma } from "@/lib/prisma";
import { resolveHouseholdRequirement } from "../assignments";
import { getHouseholdLedgerTotals, type HouseholdLedgerTotals } from "../ledger";
import { getVolunteerRequirementPeriod } from "../periods";
import type { VolunteerReportFilters, ReportInfoMeta, ReportSummaryTotals } from "./types";

/** ACTIVE households in scope for a report, honoring the household/grade/
 * classroom filters. Grade/classroom filtering reuses the same
 * current-year-enrollment lookup VH-B's assignment resolution uses,
 * applied here at the reporting layer instead. */
export async function resolveReportHouseholds(organizationId: string, filters: VolunteerReportFilters) {
  if (filters.householdId) {
    const household = await prisma.ptaHousehold.findFirst({
      where: { id: filters.householdId, organizationId },
      select: { id: true, displayName: true, status: true, primaryContactAdultId: true },
    });
    return household ? [household] : [];
  }

  let householdIds: string[] | null = null;
  if (filters.gradeId || filters.classroomId) {
    const currentYear = await prisma.ptaSchoolYear.findFirst({ where: { organizationId, isCurrent: true }, select: { id: true } });
    if (!currentYear) return [];
    const enrollments = await prisma.ptaStudentEnrollment.findMany({
      where: {
        organizationId,
        schoolYearId: currentYear.id,
        status: "ACTIVE",
        classroom: filters.gradeId ? { gradeId: filters.gradeId } : undefined,
        classroomId: filters.classroomId ?? undefined,
      },
      select: { student: { select: { householdId: true } } },
    });
    householdIds = [...new Set(enrollments.map((e) => e.student.householdId))];
  }

  return prisma.ptaHousehold.findMany({
    where: { organizationId, status: "ACTIVE", id: householdIds ? { in: householdIds } : undefined },
    select: { id: true, displayName: true, status: true, primaryContactAdultId: true },
    orderBy: { displayName: "asc" },
  });
}

export interface HouseholdReportContext {
  householdId: string;
  householdDisplayName: string;
  householdStatus: string;
  requirement: Awaited<ReturnType<typeof resolveHouseholdRequirement>>;
  totals: HouseholdLedgerTotals;
  remainingMinutes: number;
}

/** Composes VH-B + VH-D for every household in scope — the one shared
 * per-household computation every report in this program builds on, so
 * "verified means APPROVED-only," "pending never reduces remaining," etc.
 * can never drift between reports. */
export async function buildHouseholdReportContexts(organizationId: string, filters: VolunteerReportFilters): Promise<HouseholdReportContext[]> {
  const households = await resolveReportHouseholds(organizationId, filters);
  const contexts: HouseholdReportContext[] = [];
  for (const household of households) {
    const requirement = await resolveHouseholdRequirement(organizationId, filters.requirementPeriodId, household.id);
    const totals = await getHouseholdLedgerTotals(organizationId, filters.requirementPeriodId, household.id);
    const remainingMinutes = Math.max(
      0,
      requirement.requiredMinutes - totals.verifiedMinutes - totals.purchasedMinutes - totals.creditMinutes - totals.waivedMinutes
    );
    contexts.push({
      householdId: household.id,
      householdDisplayName: household.displayName,
      householdStatus: household.status,
      requirement,
      totals,
      remainingMinutes,
    });
  }
  return contexts;
}

/**
 * The one unambiguous, documented relationship between a raw
 * PtaVolunteerHourEntry and a requirement period: PtaVolunteerHourEntry has
 * no period FK of its own (only a legacy `schoolYear` scalar), but every
 * entry that has ever been processed through the real workflow
 * (setPtaVolunteerAttendanceStatus / approve / reject) gets mirrored to
 * PtaVolunteerLedgerEntry with sourceType:"hourEntry" and an explicit
 * requirementPeriodId — see mirrorHourEntry*ToLedger in ../ledger.ts. An
 * entry with no such ledger row was never processed under any period (e.g.
 * genuine pre-Requirements-feature legacy activity) and must never be
 * inferred into a period merely because it shares a household or
 * organization. Used by Reports B/C (and, transitively, F/G which
 * re-aggregate B's rows) to restrict "requirement-period mode" to entries
 * with a real, recorded relationship to the selected period.
 */
export async function resolvePeriodLinkedHourEntryIds(
  organizationId: string,
  requirementPeriodId: string,
  hourEntryIds: string[]
): Promise<ReadonlySet<string>> {
  if (hourEntryIds.length === 0) return new Set();
  const rows = await prisma.ptaVolunteerLedgerEntry.findMany({
    where: {
      organizationId,
      requirementPeriodId,
      sourceType: "hourEntry",
      sourceId: { in: hourEntryIds },
    },
    select: { sourceId: true },
  });
  return new Set(rows.map((r) => r.sourceId).filter((id): id is string => !!id));
}

export function describeAppliedFilters(filters: VolunteerReportFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (filters.dateRangeStart) out["Date range start"] = filters.dateRangeStart.toISOString().slice(0, 10);
  if (filters.dateRangeEnd) out["Date range end"] = filters.dateRangeEnd.toISOString().slice(0, 10);
  if (filters.householdId) out["Family"] = filters.householdId;
  if (filters.householdAdultId) out["Individual volunteer"] = filters.householdAdultId;
  if (filters.gradeId) out["Grade"] = filters.gradeId;
  if (filters.classroomId) out["Classroom"] = filters.classroomId;
  if (filters.eventId) out["Event"] = filters.eventId;
  if (filters.volunteerCategory) out["Volunteer category"] = filters.volunteerCategory;
  if (filters.approvalStatus) out["Approval status"] = filters.approvalStatus;
  if (filters.requirementStatus) out["Requirement status"] = filters.requirementStatus;
  if (filters.paymentStatus) out["Payment status"] = filters.paymentStatus;
  return out;
}

export async function buildReportInfo(
  organizationId: string,
  filters: VolunteerReportFilters,
  reportTitle: string,
  generatedByName: string,
  calculationNotes: string[]
): Promise<ReportInfoMeta> {
  const [org, period, orgSettings] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    getVolunteerRequirementPeriod(organizationId, filters.requirementPeriodId),
    prisma.orgSettings.findUnique({ where: { organizationId }, select: { timezone: true } }),
  ]);

  return {
    organizationName: org?.name ?? "Unknown organization",
    reportTitle,
    requirementPeriodName: period.name,
    coveredDateRange: `${period.startsOn.toISOString().slice(0, 10)} to ${period.endsOn.toISOString().slice(0, 10)}`,
    appliedFilters: describeAppliedFilters(filters),
    generatedAt: new Date(),
    organizationTimezone: orgSettings?.timezone ?? period.timezone,
    generatedByName,
    calculationNotes,
  };
}

export const STANDARD_CALCULATION_NOTES = [
  "Verified hours = APPROVED entries only. Pending and rejected hours are never counted as verified.",
  "Event hours = verified hours tied to an Unestra event record; non-event hours = every other verified category.",
  "Purchased and waived hours may satisfy the requirement but are never reported as hours actually volunteered.",
  "Remaining required hours = max(0, adjusted required − verified − purchased − administrative credits − waived), never negative.",
];

export async function resolveGeneratedByName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
  return user?.displayName || user?.email || "Unknown user";
}

const APPROVAL_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);
const REPORT_MODES = new Set(["PERIOD", "ALL_TIME"]);

/** Parses the query-string filters every Report A-D route accepts, shared
 * so the on-screen JSON route and the .xlsx export route (spec §14) always
 * derive identical VolunteerReportFilters from the same request shape.
 * `mode` must be explicitly requested as "ALL_TIME" via ?mode=ALL_TIME —
 * any other/missing value defaults to "PERIOD", never the reverse. */
export function parseVolunteerReportFilters(url: URL, requirementPeriodId: string): VolunteerReportFilters {
  const params = url.searchParams;
  const dateRangeStart = params.get("dateRangeStart");
  const dateRangeEnd = params.get("dateRangeEnd");
  const approvalStatus = params.get("approvalStatus");
  const mode = params.get("mode");
  return {
    requirementPeriodId,
    mode: mode && REPORT_MODES.has(mode) ? (mode as VolunteerReportFilters["mode"]) : "PERIOD",
    dateRangeStart: dateRangeStart ? new Date(dateRangeStart) : undefined,
    dateRangeEnd: dateRangeEnd ? new Date(dateRangeEnd) : undefined,
    householdId: params.get("householdId") ?? undefined,
    householdAdultId: params.get("householdAdultId") ?? undefined,
    gradeId: params.get("gradeId") ?? undefined,
    classroomId: params.get("classroomId") ?? undefined,
    eventId: params.get("eventId") ?? undefined,
    volunteerCategory: params.get("volunteerCategory") ?? undefined,
    approvalStatus: approvalStatus && APPROVAL_STATUSES.has(approvalStatus) ? (approvalStatus as VolunteerReportFilters["approvalStatus"]) : undefined,
    requirementStatus: params.get("requirementStatus") ?? undefined,
    paymentStatus: params.get("paymentStatus") ?? undefined,
  };
}

/** Serializes VolunteerReportFilters (which carries Date objects) into a
 * plain JSON-safe shape for storage on ReportExport.filters, and back. Used
 * by the background-export queue so a queued job can re-derive the exact
 * same filters the caller applied on-screen, without re-parsing a URL. */
export function volunteerReportFiltersToJson(
  filters: VolunteerReportFilters & { complianceFilter?: string }
): Record<string, string | null> {
  return {
    requirementPeriodId: filters.requirementPeriodId,
    mode: filters.mode ?? "PERIOD",
    dateRangeStart: filters.dateRangeStart ? filters.dateRangeStart.toISOString() : null,
    dateRangeEnd: filters.dateRangeEnd ? filters.dateRangeEnd.toISOString() : null,
    householdId: filters.householdId ?? null,
    householdAdultId: filters.householdAdultId ?? null,
    gradeId: filters.gradeId ?? null,
    classroomId: filters.classroomId ?? null,
    eventId: filters.eventId ?? null,
    volunteerCategory: filters.volunteerCategory ?? null,
    approvalStatus: filters.approvalStatus ?? null,
    requirementStatus: filters.requirementStatus ?? null,
    paymentStatus: filters.paymentStatus ?? null,
    complianceFilter: filters.complianceFilter ?? null,
  };
}

export function volunteerReportFiltersFromJson(json: unknown): VolunteerReportFilters & { complianceFilter?: string } {
  const j = (json && typeof json === "object" ? (json as Record<string, unknown>) : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
  const date = (v: unknown): Date | undefined => (typeof v === "string" && v.length > 0 ? new Date(v) : undefined);
  const mode = str(j.mode);
  return {
    requirementPeriodId: str(j.requirementPeriodId) ?? "",
    mode: mode === "ALL_TIME" ? "ALL_TIME" : "PERIOD",
    dateRangeStart: date(j.dateRangeStart),
    dateRangeEnd: date(j.dateRangeEnd),
    householdId: str(j.householdId),
    householdAdultId: str(j.householdAdultId),
    gradeId: str(j.gradeId),
    classroomId: str(j.classroomId),
    eventId: str(j.eventId),
    volunteerCategory: str(j.volunteerCategory),
    approvalStatus: str(j.approvalStatus) as VolunteerReportFilters["approvalStatus"],
    requirementStatus: str(j.requirementStatus),
    paymentStatus: str(j.paymentStatus),
    complianceFilter: str(j.complianceFilter),
  };
}

export function emptySummaryTotals(): ReportSummaryTotals {
  return {
    totalFamilies: 0,
    totalIndividualVolunteers: 0,
    totalVerifiedMinutes: 0,
    totalEventMinutes: 0,
    totalNonEventMinutes: 0,
    totalPendingMinutes: 0,
    totalPurchasedMinutes: 0,
    totalWaivedMinutes: 0,
    totalRemainingMinutes: 0,
    familiesMeetingRequirement: 0,
    familiesNotMeetingRequirement: 0,
    familiesExempt: 0,
    totalBuyoutRevenueCents: 0,
    totalAssessmentsCents: 0,
    outstandingBalanceCents: 0,
  };
}
