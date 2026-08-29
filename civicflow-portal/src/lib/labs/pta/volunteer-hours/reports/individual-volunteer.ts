import { buildDetailActivityReportData } from "./detail-activity";
import { buildReportInfo, emptySummaryTotals, STANDARD_CALCULATION_NOTES } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

export interface IndividualVolunteerRow {
  householdAdultId: string;
  volunteerName: string;
  householdDisplayName: string;
  relationship: string | null;
  verifiedMinutes: number;
  eventMinutes: number;
  nonEventMinutes: number;
  pendingMinutes: number;
  entryCount: number;
  categoriesServed: string;
  firstServiceDate: Date | null;
  lastServiceDate: Date | null;
}

/**
 * Report F: Individual Volunteer Report (spec §11) — one row per person who
 * logged hours, for recognition/certificate purposes. Deliberately built by
 * re-aggregating Report B's own rows rather than re-querying Prisma from
 * scratch — Report B already resolved the same manual opportunity/slot/
 * adult/household joins this report needs, and aggregating its output
 * guarantees the two reports can never disagree about what counts as
 * verified time for a given entry.
 */
export async function buildIndividualVolunteerReportData(
  organizationId: string,
  filters: VolunteerReportFilters,
  generatedByName: string
): Promise<ReportData<IndividualVolunteerRow>> {
  const detail = await buildDetailActivityReportData(organizationId, filters, generatedByName);

  const byAdult = new Map<string, IndividualVolunteerRow & { categories: Set<string> }>();
  for (const entry of detail.rows) {
    let row = byAdult.get(entry.householdAdultId);
    if (!row) {
      row = {
        householdAdultId: entry.householdAdultId,
        volunteerName: entry.volunteerName,
        householdDisplayName: entry.householdDisplayName,
        relationship: entry.relationship,
        verifiedMinutes: 0,
        eventMinutes: 0,
        nonEventMinutes: 0,
        pendingMinutes: 0,
        entryCount: 0,
        categoriesServed: "",
        firstServiceDate: null,
        lastServiceDate: null,
        categories: new Set<string>(),
      };
      byAdult.set(entry.householdAdultId, row);
    }
    if (entry.approvalStatus === "APPROVED") {
      row.verifiedMinutes += entry.reportedMinutes;
      if (entry.isEventBased) row.eventMinutes += entry.reportedMinutes;
      else row.nonEventMinutes += entry.reportedMinutes;
      row.entryCount += 1;
      if (entry.volunteerCategory) row.categories.add(entry.volunteerCategory);
      if (entry.serviceDate) {
        if (!row.firstServiceDate || entry.serviceDate < row.firstServiceDate) row.firstServiceDate = entry.serviceDate;
        if (!row.lastServiceDate || entry.serviceDate > row.lastServiceDate) row.lastServiceDate = entry.serviceDate;
      }
    } else if (entry.approvalStatus === "PENDING") {
      row.pendingMinutes += entry.reportedMinutes;
    }
  }

  const rows = [...byAdult.values()]
    .map((r) => ({ ...r, categoriesServed: [...r.categories].sort().join(", ") }))
    .filter((r) => r.verifiedMinutes > 0 || r.pendingMinutes > 0)
    .map(({ categories, ...rest }) => {
      void categories;
      return rest;
    })
    .sort((a, b) => b.verifiedMinutes - a.verifiedMinutes);

  const summary = emptySummaryTotals();
  summary.totalIndividualVolunteers = rows.length;
  summary.totalFamilies = new Set(rows.map((r) => r.householdDisplayName)).size;
  for (const row of rows) {
    summary.totalVerifiedMinutes += row.verifiedMinutes;
    summary.totalEventMinutes += row.eventMinutes;
    summary.totalNonEventMinutes += row.nonEventMinutes;
    summary.totalPendingMinutes += row.pendingMinutes;
  }

  const reportTitle = filters.mode === "ALL_TIME" ? "Individual Volunteer Report (All-Time)" : "Individual Volunteer Report";
  const info = await buildReportInfo(organizationId, filters, reportTitle, generatedByName, [
    ...STANDARD_CALCULATION_NOTES,
    filters.mode === "ALL_TIME"
      ? "ALL-TIME MODE: one row per individual who logged at least one pending or verified hour entry across every requirement period (or no period at all) — computed from the same raw entries as All-Time Volunteer Activity."
      : "One row per individual who logged at least one pending or verified hour entry within the selected requirement period — computed from the same period-filtered entries as the Detailed Family Volunteer Activity report.",
  ]);
  return { info, summary, rows };
}

export const INDIVIDUAL_VOLUNTEER_COLUMNS: ReportColumn<IndividualVolunteerRow>[] = [
  { header: "Volunteer", format: "text", width: 22, getValue: (r) => r.volunteerName },
  { header: "Family", format: "text", width: 22, getValue: (r) => r.householdDisplayName },
  { header: "Relationship", format: "text", width: 14, getValue: (r) => r.relationship },
  { header: "Verified (h)", format: "hours", width: 12, getValue: (r) => r.verifiedMinutes },
  { header: "Event (h)", format: "hours", width: 12, getValue: (r) => r.eventMinutes },
  { header: "Non-event (h)", format: "hours", width: 12, getValue: (r) => r.nonEventMinutes },
  { header: "Pending (h)", format: "hours", width: 12, getValue: (r) => r.pendingMinutes },
  { header: "Entries", format: "integer", width: 10, getValue: (r) => r.entryCount },
  { header: "Categories served", format: "text", width: 30, getValue: (r) => r.categoriesServed },
  { header: "First service date", format: "date", width: 14, getValue: (r) => r.firstServiceDate },
  { header: "Last service date", format: "date", width: 14, getValue: (r) => r.lastServiceDate },
];
