import { prisma } from "@/lib/prisma";
import { getVolunteerRequirementPeriod } from "../periods";
import { buildReportInfo, emptySummaryTotals, resolvePeriodLinkedHourEntryIds, STANDARD_CALCULATION_NOTES } from "./shared";
import type { ReportColumn } from "./xlsx-builder";
import type { ReportData, VolunteerReportFilters } from "./types";

export interface EventHoursRow {
  eventName: string;
  eventId: string;
  eventDate: Date | null;
  location: string | null;
  opportunityCount: number;
  signupCount: number;
  attendedCount: number;
  noShowCount: number;
  familyCount: number;
  individualVolunteerCount: number;
  totalReportedMinutes: number;
  totalVerifiedMinutes: number;
  totalPendingMinutes: number;
  totalRejectedMinutes: number;
  averageVerifiedMinutesPerVolunteer: number;
  eventStatus: string;
}

const ATTENDED_SIGNUP_STATUSES = new Set(["ATTENDED", "COMPLETED", "PARTIAL"]);

/**
 * Report C: Event Volunteer-Hours Report — one row per event, aggregated
 * across every opportunity linked to it (spec §11). Attendance/no-show
 * counts come from PtaVolunteerSignup.status (never inferred from hour
 * entries, which only exist for CREDITED time).
 *
 * Period scope (docs/pta-volunteer-hours-report-period-scope-fix.md): in
 * requirement-period mode (filters.mode !== "ALL_TIME", the default), the
 * event date window defaults to the selected period's own [startsOn,
 * endsOn] range when the caller doesn't supply an explicit date filter, and
 * every credited-hour figure (reported/verified/pending/rejected minutes)
 * is restricted to hour entries with a recorded relationship to the
 * selected period — an event being associated with a household is not
 * enough on its own. ALL_TIME mode (explicit opt-in only) skips both
 * restrictions.
 */
export async function buildEventHoursReportData(
  organizationId: string,
  filters: VolunteerReportFilters,
  generatedByName: string
): Promise<ReportData<EventHoursRow>> {
  const allTime = filters.mode === "ALL_TIME";
  const period = allTime ? null : await getVolunteerRequirementPeriod(organizationId, filters.requirementPeriodId);
  const effectiveDateRangeStart = filters.dateRangeStart ?? period?.startsOn;
  const effectiveDateRangeEnd = filters.dateRangeEnd ?? period?.endsOn;

  const opportunities = await prisma.ptaVolunteerOpportunity.findMany({
    where: {
      organizationId,
      eventId: filters.eventId ? filters.eventId : { not: null },
    },
    select: {
      id: true,
      eventId: true,
      event: { select: { id: true, title: true, startAt: true, location: true, status: true } },
    },
  });

  const opportunityIds = opportunities.map((o) => o.id);
  // PtaVolunteerSignup has no opportunityId of its own — only slotId (a real
  // relation) — so signups attribute to an opportunity/event via their slot,
  // never a direct field.
  const slots = await prisma.ptaVolunteerSlot.findMany({
    where: { organizationId, opportunityId: { in: opportunityIds } },
    select: { id: true, opportunityId: true },
  });
  const slotToOpportunity = new Map(slots.map((s) => [s.id, s.opportunityId]));
  const slotIds = slots.map((s) => s.id);

  const [signupsRaw, candidateEntries] = await Promise.all([
    prisma.ptaVolunteerSignup.findMany({
      where: { organizationId, slotId: { in: slotIds }, status: { not: "CANCELLED" } },
      select: { slotId: true, status: true, householdId: true, householdAdultId: true },
    }),
    prisma.ptaVolunteerHourEntry.findMany({
      where: { organizationId, opportunityId: { in: opportunityIds } },
      select: { id: true, opportunityId: true, status: true, creditedMinutes: true, householdId: true, householdAdultId: true },
    }),
  ]);
  const signups = signupsRaw.map((s) => ({ ...s, opportunityId: slotToOpportunity.get(s.slotId) ?? "" }));

  const periodLinkedIds = allTime
    ? null
    : await resolvePeriodLinkedHourEntryIds(
        organizationId,
        filters.requirementPeriodId,
        candidateEntries.map((e) => e.id)
      );
  const entries = allTime ? candidateEntries : candidateEntries.filter((e) => periodLinkedIds!.has(e.id));

  const opportunityToEvent = new Map(opportunities.map((o) => [o.id, o.event]));
  const eventGroups = new Map<string, { opportunityIds: Set<string> }>();
  for (const o of opportunities) {
    if (!o.eventId) continue;
    if (!eventGroups.has(o.eventId)) eventGroups.set(o.eventId, { opportunityIds: new Set() });
    eventGroups.get(o.eventId)!.opportunityIds.add(o.id);
  }

  const rows: EventHoursRow[] = [];
  for (const [eventId, group] of eventGroups) {
    const event = [...group.opportunityIds].map((id) => opportunityToEvent.get(id)).find(Boolean);
    if (!event) continue;
    if (effectiveDateRangeStart && event.startAt && event.startAt < effectiveDateRangeStart) continue;
    if (effectiveDateRangeEnd && event.startAt && event.startAt > effectiveDateRangeEnd) continue;

    const eventSignups = signups.filter((s) => group.opportunityIds.has(s.opportunityId));
    const eventEntries = entries.filter((e) => group.opportunityIds.has(e.opportunityId));

    const families = new Set<string>();
    const volunteers = new Set<string>();
    let totalReportedMinutes = 0;
    let totalVerifiedMinutes = 0;
    let totalPendingMinutes = 0;
    let totalRejectedMinutes = 0;
    for (const entry of eventEntries) {
      totalReportedMinutes += entry.creditedMinutes;
      if (entry.status === "APPROVED") totalVerifiedMinutes += entry.creditedMinutes;
      else if (entry.status === "PENDING") totalPendingMinutes += entry.creditedMinutes;
      else if (entry.status === "REJECTED") totalRejectedMinutes += entry.creditedMinutes;
      if (entry.householdId) families.add(entry.householdId);
      volunteers.add(entry.householdAdultId);
    }
    for (const signup of eventSignups) {
      if (signup.householdId) families.add(signup.householdId);
      volunteers.add(signup.householdAdultId);
    }

    rows.push({
      eventName: event.title,
      eventId,
      eventDate: event.startAt,
      location: event.location,
      opportunityCount: group.opportunityIds.size,
      signupCount: eventSignups.length,
      attendedCount: eventSignups.filter((s) => ATTENDED_SIGNUP_STATUSES.has(s.status)).length,
      noShowCount: eventSignups.filter((s) => s.status === "NO_SHOW").length,
      familyCount: families.size,
      individualVolunteerCount: volunteers.size,
      totalReportedMinutes,
      totalVerifiedMinutes,
      totalPendingMinutes,
      totalRejectedMinutes,
      averageVerifiedMinutesPerVolunteer: volunteers.size > 0 ? Math.round(totalVerifiedMinutes / volunteers.size) : 0,
      eventStatus: event.status,
    });
  }
  rows.sort((a, b) => (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0));

  const summary = emptySummaryTotals();
  const allFamilies = new Set<string>();
  const allVolunteers = new Set<string>();
  for (const row of rows) {
    summary.totalVerifiedMinutes += row.totalVerifiedMinutes;
    summary.totalEventMinutes += row.totalVerifiedMinutes;
    summary.totalPendingMinutes += row.totalPendingMinutes;
  }
  summary.totalFamilies = allFamilies.size;
  summary.totalIndividualVolunteers = allVolunteers.size;

  const calculationNotes = allTime
    ? [
        ...STANDARD_CALCULATION_NOTES,
        "ALL-TIME MODE: shows every event with recorded activity, across every requirement period (or no period at all) — not restricted to one period.",
      ]
    : [
        ...STANDARD_CALCULATION_NOTES,
        "Restricted to the selected requirement period: events are windowed to the period's own dates by default, and credited-hour totals include only hour entries with a recorded relationship to the selected period.",
      ];

  const info = await buildReportInfo(organizationId, filters, "Event Volunteer-Hours Report", generatedByName, calculationNotes);
  return { info, summary, rows };
}

export const EVENT_HOURS_COLUMNS: ReportColumn<EventHoursRow>[] = [
  { header: "Event", format: "text", width: 26, getValue: (r) => r.eventName },
  { header: "Event date", format: "date", width: 12, getValue: (r) => r.eventDate },
  { header: "Location", format: "text", width: 18, getValue: (r) => r.location },
  { header: "Opportunities", format: "integer", width: 12, getValue: (r) => r.opportunityCount },
  { header: "Signups", format: "integer", width: 10, getValue: (r) => r.signupCount },
  { header: "Attended", format: "integer", width: 10, getValue: (r) => r.attendedCount },
  { header: "No-shows", format: "integer", width: 10, getValue: (r) => r.noShowCount },
  { header: "Families", format: "integer", width: 10, getValue: (r) => r.familyCount },
  { header: "Individual volunteers", format: "integer", width: 16, getValue: (r) => r.individualVolunteerCount },
  { header: "Reported (h)", format: "hours", width: 12, getValue: (r) => r.totalReportedMinutes },
  { header: "Verified (h)", format: "hours", width: 12, getValue: (r) => r.totalVerifiedMinutes },
  { header: "Pending (h)", format: "hours", width: 12, getValue: (r) => r.totalPendingMinutes },
  { header: "Rejected (h)", format: "hours", width: 12, getValue: (r) => r.totalRejectedMinutes },
  { header: "Avg verified (h)/volunteer", format: "hours", width: 18, getValue: (r) => r.averageVerifiedMinutesPerVolunteer },
  { header: "Status", format: "text", width: 12, getValue: (r) => r.eventStatus },
];
