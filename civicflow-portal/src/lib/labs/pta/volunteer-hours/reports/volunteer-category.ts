import { buildDetailActivityReportData } from "./detail-activity";
import { buildReportInfo, emptySummaryTotals, STANDARD_CALCULATION_NOTES } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

export interface VolunteerCategoryRow {
  category: string;
  verifiedMinutes: number;
  pendingMinutes: number;
  rejectedMinutes: number;
  eventMinutes: number;
  nonEventMinutes: number;
  entryCount: number;
  uniqueVolunteers: number;
  uniqueFamilies: number;
}

/**
 * Report G: Volunteer Category Report (spec §11) — one row per volunteer
 * category, org-wide, for understanding where volunteer effort concentrates.
 * Like Report F, built by re-aggregating Report B's own rows rather than a
 * fresh query, so category totals can never disagree with the detail report
 * they're derived from. Uncategorized legacy entries (category === null)
 * are grouped under "UNCATEGORIZED" rather than silently dropped.
 */
export async function buildVolunteerCategoryReportData(
  organizationId: string,
  filters: VolunteerReportFilters,
  generatedByName: string
): Promise<ReportData<VolunteerCategoryRow>> {
  const detail = await buildDetailActivityReportData(organizationId, filters, generatedByName);

  const byCategory = new Map<
    string,
    VolunteerCategoryRow & { volunteers: Set<string>; families: Set<string> }
  >();
  for (const entry of detail.rows) {
    const category = entry.volunteerCategory ?? "UNCATEGORIZED";
    let row = byCategory.get(category);
    if (!row) {
      row = {
        category,
        verifiedMinutes: 0,
        pendingMinutes: 0,
        rejectedMinutes: 0,
        eventMinutes: 0,
        nonEventMinutes: 0,
        entryCount: 0,
        uniqueVolunteers: 0,
        uniqueFamilies: 0,
        volunteers: new Set<string>(),
        families: new Set<string>(),
      };
      byCategory.set(category, row);
    }
    row.entryCount += 1;
    if (entry.approvalStatus === "APPROVED") {
      row.verifiedMinutes += entry.reportedMinutes;
      if (entry.isEventBased) row.eventMinutes += entry.reportedMinutes;
      else row.nonEventMinutes += entry.reportedMinutes;
      row.volunteers.add(entry.householdAdultId);
      row.families.add(entry.householdDisplayName);
    } else if (entry.approvalStatus === "PENDING") {
      row.pendingMinutes += entry.reportedMinutes;
    } else if (entry.approvalStatus === "REJECTED") {
      row.rejectedMinutes += entry.reportedMinutes;
    }
  }

  const rows = [...byCategory.values()]
    .map((r) => ({ ...r, uniqueVolunteers: r.volunteers.size, uniqueFamilies: r.families.size }))
    .map(({ volunteers, families, ...rest }) => {
      void volunteers;
      void families;
      return rest;
    })
    .sort((a, b) => b.verifiedMinutes - a.verifiedMinutes);

  const summary = emptySummaryTotals();
  const allVolunteers = new Set<string>();
  const allFamilies = new Set<string>();
  for (const entry of detail.rows) {
    if (entry.approvalStatus !== "APPROVED") continue;
    allVolunteers.add(entry.householdAdultId);
    allFamilies.add(entry.householdDisplayName);
  }
  summary.totalIndividualVolunteers = allVolunteers.size;
  summary.totalFamilies = allFamilies.size;
  for (const row of rows) {
    summary.totalVerifiedMinutes += row.verifiedMinutes;
    summary.totalEventMinutes += row.eventMinutes;
    summary.totalNonEventMinutes += row.nonEventMinutes;
    summary.totalPendingMinutes += row.pendingMinutes;
  }

  const reportTitle = filters.mode === "ALL_TIME" ? "Volunteer Category Report (All-Time)" : "Volunteer Category Report";
  const info = await buildReportInfo(organizationId, filters, reportTitle, generatedByName, [
    ...STANDARD_CALCULATION_NOTES,
    "Legacy entries with no category recorded are grouped under UNCATEGORIZED rather than excluded.",
    filters.mode === "ALL_TIME"
      ? "ALL-TIME MODE: aggregates activity across every requirement period (or no period at all) — not restricted to one period."
      : "Restricted to the selected requirement period — aggregates the same period-filtered entries as the Detailed Family Volunteer Activity report.",
  ]);
  return { info, summary, rows };
}

export const VOLUNTEER_CATEGORY_COLUMNS: ReportColumn<VolunteerCategoryRow>[] = [
  { header: "Category", format: "text", width: 22, getValue: (r) => r.category },
  { header: "Verified (h)", format: "hours", width: 12, getValue: (r) => r.verifiedMinutes },
  { header: "Pending (h)", format: "hours", width: 12, getValue: (r) => r.pendingMinutes },
  { header: "Rejected (h)", format: "hours", width: 12, getValue: (r) => r.rejectedMinutes },
  { header: "Event (h)", format: "hours", width: 12, getValue: (r) => r.eventMinutes },
  { header: "Non-event (h)", format: "hours", width: 12, getValue: (r) => r.nonEventMinutes },
  { header: "Entries", format: "integer", width: 10, getValue: (r) => r.entryCount },
  { header: "Unique volunteers", format: "integer", width: 16, getValue: (r) => r.uniqueVolunteers },
  { header: "Unique families", format: "integer", width: 14, getValue: (r) => r.uniqueFamilies },
];
