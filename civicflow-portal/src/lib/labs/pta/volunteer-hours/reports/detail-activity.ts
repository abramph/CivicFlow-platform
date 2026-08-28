import type { PtaVolunteerCategory, PtaVolunteerHourEntryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildReportInfo, emptySummaryTotals, resolveReportHouseholds, STANDARD_CALCULATION_NOTES } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

export interface DetailActivityRow {
  householdDisplayName: string;
  volunteerName: string;
  relationship: string | null;
  serviceDate: Date | null;
  eventOrActivityName: string;
  eventId: string | null;
  volunteerCategory: string | null;
  isEventBased: boolean;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  reportedMinutes: number;
  approvalStatus: string;
  approvedByName: string | null;
  approvalDate: Date | null;
  location: string | null;
  notes: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Report B: Detailed Family Volunteer Activity — one row per raw hour
 * entry (spec §11). PtaVolunteerHourEntry has no Prisma relations to
 * household/opportunity/slot (they're informal scalar references, unlike
 * its real `signup` relation) — every join here is a deliberate manual
 * batch fetch-and-merge rather than a nested `include`.
 */
export async function buildDetailActivityReportData(
  organizationId: string,
  filters: VolunteerReportFilters,
  generatedByName: string
): Promise<ReportData<DetailActivityRow>> {
  const households = filters.householdId ? [{ id: filters.householdId }] : await resolveReportHouseholds(organizationId, filters);
  const householdIds = households.map((h) => h.id);

  const entries = await prisma.ptaVolunteerHourEntry.findMany({
    where: {
      organizationId,
      householdId: householdIds.length > 0 ? { in: householdIds } : undefined,
      status: filters.approvalStatus as PtaVolunteerHourEntryStatus | undefined,
      category: filters.volunteerCategory as PtaVolunteerCategory | undefined,
    },
    orderBy: { createdAt: "desc" },
  });

  const opportunityIds = [...new Set(entries.map((e) => e.opportunityId))];
  const slotIds = [...new Set(entries.map((e) => e.slotId))];
  const adultIds = [...new Set(entries.map((e) => e.householdAdultId))];
  const householdIdsInEntries = [...new Set(entries.map((e) => e.householdId).filter((id): id is string => !!id))];
  const approverIds = [...new Set(entries.map((e) => e.approvedByUserId).filter((id): id is string => !!id))];

  const [opportunities, slots, adults, householdRows, approvers] = await Promise.all([
    prisma.ptaVolunteerOpportunity.findMany({ where: { id: { in: opportunityIds } }, select: { id: true, title: true, eventId: true } }),
    prisma.ptaVolunteerSlot.findMany({ where: { id: { in: slotIds } }, select: { id: true, startAt: true, endAt: true, locationOverride: true } }),
    prisma.ptaHouseholdAdult.findMany({ where: { id: { in: adultIds } }, select: { id: true, name: true, relationshipLabel: true } }),
    prisma.ptaHousehold.findMany({ where: { id: { in: householdIdsInEntries } }, select: { id: true, displayName: true } }),
    approverIds.length > 0 ? prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, displayName: true, email: true } }) : Promise.resolve([]),
  ]);

  const opportunityById = new Map(opportunities.map((o) => [o.id, o]));
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const adultById = new Map(adults.map((a) => [a.id, a]));
  const householdById = new Map(householdRows.map((h) => [h.id, h]));
  const approverById = new Map(approvers.map((u) => [u.id, u.displayName || u.email]));

  const rows: DetailActivityRow[] = [];
  for (const entry of entries) {
    const opportunity = opportunityById.get(entry.opportunityId);
    const slot = slotById.get(entry.slotId);
    if (filters.eventId && opportunity?.eventId !== filters.eventId) continue;
    const serviceDate = slot?.startAt ?? entry.approvedAt ?? entry.createdAt;
    if (filters.dateRangeStart && serviceDate < filters.dateRangeStart) continue;
    if (filters.dateRangeEnd && serviceDate > filters.dateRangeEnd) continue;

    const adult = adultById.get(entry.householdAdultId);
    rows.push({
      householdDisplayName: entry.householdId ? (householdById.get(entry.householdId)?.displayName ?? "") : "",
      volunteerName: adult?.name ?? "Unknown",
      relationship: adult?.relationshipLabel ?? null,
      serviceDate: slot?.startAt ?? null,
      eventOrActivityName: opportunity?.title ?? "Unknown activity",
      eventId: opportunity?.eventId ?? null,
      volunteerCategory: entry.category,
      isEventBased: Boolean(opportunity?.eventId),
      scheduledStart: slot?.startAt ?? null,
      scheduledEnd: slot?.endAt ?? null,
      reportedMinutes: entry.creditedMinutes,
      approvalStatus: entry.status,
      approvedByName: entry.approvedByUserId ? (approverById.get(entry.approvedByUserId) ?? entry.approvedByUserId) : null,
      approvalDate: entry.approvedAt,
      location: slot?.locationOverride ?? null,
      notes: entry.notes,
      source: entry.source,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }

  const summary = emptySummaryTotals();
  const uniqueVolunteers = new Set<string>();
  const uniqueFamilies = new Set<string>();
  for (const row of rows) {
    uniqueVolunteers.add(row.volunteerName);
    uniqueFamilies.add(row.householdDisplayName);
    if (row.approvalStatus === "APPROVED") {
      summary.totalVerifiedMinutes += row.reportedMinutes;
      if (row.isEventBased) summary.totalEventMinutes += row.reportedMinutes;
      else summary.totalNonEventMinutes += row.reportedMinutes;
    } else if (row.approvalStatus === "PENDING") {
      summary.totalPendingMinutes += row.reportedMinutes;
    }
  }
  summary.totalFamilies = uniqueFamilies.size;
  summary.totalIndividualVolunteers = uniqueVolunteers.size;

  const info = await buildReportInfo(organizationId, filters, "Detailed Family Volunteer Activity", generatedByName, STANDARD_CALCULATION_NOTES);
  return { info, summary, rows };
}

export const DETAIL_ACTIVITY_COLUMNS: ReportColumn<DetailActivityRow>[] = [
  { header: "Family", format: "text", width: 22, getValue: (r) => r.householdDisplayName },
  { header: "Volunteer", format: "text", width: 20, getValue: (r) => r.volunteerName },
  { header: "Relationship", format: "text", width: 14, getValue: (r) => r.relationship },
  { header: "Service date", format: "date", width: 12, getValue: (r) => r.serviceDate },
  { header: "Event / activity", format: "text", width: 26, getValue: (r) => r.eventOrActivityName },
  { header: "Category", format: "text", width: 18, getValue: (r) => r.volunteerCategory },
  { header: "Event-based", format: "text", width: 12, getValue: (r) => (r.isEventBased ? "Yes" : "No") },
  { header: "Scheduled start", format: "datetime", width: 16, getValue: (r) => r.scheduledStart },
  { header: "Scheduled end", format: "datetime", width: 16, getValue: (r) => r.scheduledEnd },
  { header: "Reported (h)", format: "hours", width: 12, getValue: (r) => r.reportedMinutes },
  { header: "Approval status", format: "text", width: 14, getValue: (r) => r.approvalStatus },
  { header: "Approved by", format: "text", width: 18, getValue: (r) => r.approvedByName },
  { header: "Approval date", format: "date", width: 14, getValue: (r) => r.approvalDate },
  { header: "Location", format: "text", width: 18, getValue: (r) => r.location },
  { header: "Notes", format: "text", width: 30, getValue: (r) => r.notes },
  { header: "Source", format: "text", width: 14, getValue: (r) => r.source },
  { header: "Created", format: "date", width: 12, getValue: (r) => r.createdAt },
];
