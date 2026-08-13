import { prisma } from "@/lib/prisma";

/**
 * PTA Vertical 2.0, PR PTA-G — volunteer reporting (brief §16). Aggregates
 * the APPROVED hour ledger (the authoritative record PTA-era PRs built) plus
 * live staffing state. Officer-facing only: the "most active volunteers"
 * list is a coordination tool behind pta:volunteers:manage, never a public
 * competitive ranking (§16's explicit rule).
 */

export interface VolunteerReport {
  schoolYear: string | null;
  totals: { approvedMinutes: number; approvedEntries: number; distinctVolunteers: number };
  byEvent: { label: string; minutes: number; volunteers: number }[];
  byCommittee: { label: string; minutes: number; volunteers: number }[];
  topVolunteers: { name: string; minutes: number; entries: number }[];
  unfilledOpportunities: { title: string; startAt: Date | null; openSpots: number; totalCapacity: number }[];
  participationByMonth: { month: string; minutes: number; volunteers: number }[];
}

export async function getVolunteerReport(organizationId: string, options: { schoolYear?: string | null } = {}): Promise<VolunteerReport> {
  const schoolYear =
    options.schoolYear !== undefined
      ? options.schoolYear
      : ((await prisma.ptaProfile.findUnique({ where: { organizationId }, select: { currentSchoolYear: true } }))?.currentSchoolYear ?? null);

  const entries = await prisma.ptaVolunteerHourEntry.findMany({
    where: { organizationId, status: "APPROVED", ...(schoolYear ? { schoolYear } : {}) },
    include: {
      signup: {
        select: {
          householdAdult: { select: { id: true, name: true } },
          slot: {
            select: {
              startAt: true,
              opportunity: {
                select: {
                  title: true,
                  event: { select: { title: true } },
                  committee: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
    take: 5000,
  });

  const totals = { approvedMinutes: 0, approvedEntries: entries.length, distinctVolunteers: 0 };
  const byEvent = new Map<string, { minutes: number; adults: Set<string> }>();
  const byCommittee = new Map<string, { minutes: number; adults: Set<string> }>();
  const byAdult = new Map<string, { name: string; minutes: number; entries: number }>();
  const byMonth = new Map<string, { minutes: number; adults: Set<string> }>();

  for (const entry of entries) {
    totals.approvedMinutes += entry.creditedMinutes;
    const adult = entry.signup.householdAdult;
    const opportunity = entry.signup.slot.opportunity;

    const adultRow = byAdult.get(adult.id) ?? { name: adult.name, minutes: 0, entries: 0 };
    adultRow.minutes += entry.creditedMinutes;
    adultRow.entries += 1;
    byAdult.set(adult.id, adultRow);

    const eventLabel = opportunity.event?.title ?? `(no event) ${opportunity.title}`;
    const eventRow = byEvent.get(eventLabel) ?? { minutes: 0, adults: new Set<string>() };
    eventRow.minutes += entry.creditedMinutes;
    eventRow.adults.add(adult.id);
    byEvent.set(eventLabel, eventRow);

    if (opportunity.committee) {
      const committeeRow = byCommittee.get(opportunity.committee.name) ?? { minutes: 0, adults: new Set<string>() };
      committeeRow.minutes += entry.creditedMinutes;
      committeeRow.adults.add(adult.id);
      byCommittee.set(opportunity.committee.name, committeeRow);
    }

    const when = entry.signup.slot.startAt ?? entry.createdAt;
    const monthKey = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
    const monthRow = byMonth.get(monthKey) ?? { minutes: 0, adults: new Set<string>() };
    monthRow.minutes += entry.creditedMinutes;
    monthRow.adults.add(adult.id);
    byMonth.set(monthKey, monthRow);
  }
  totals.distinctVolunteers = byAdult.size;

  // Live staffing: open upcoming opportunities with unclaimed capacity.
  const openOpportunities = await prisma.ptaVolunteerOpportunity.findMany({
    where: { organizationId, status: "OPEN", ...(schoolYear ? { schoolYear } : {}) },
    include: { slots: { where: { status: "OPEN" }, select: { capacity: true, claimedCount: true } } },
    orderBy: [{ startAt: { sort: "asc", nulls: "last" } }],
    take: 200,
  });
  const unfilledOpportunities = openOpportunities
    .map((opportunity) => {
      const totalCapacity = opportunity.slots.reduce((sum, slot) => sum + slot.capacity, 0);
      const claimed = opportunity.slots.reduce((sum, slot) => sum + slot.claimedCount, 0);
      return { title: opportunity.title, startAt: opportunity.startAt, openSpots: Math.max(0, totalCapacity - claimed), totalCapacity };
    })
    .filter((row) => row.openSpots > 0);

  const sortedMinutes = (map: Map<string, { minutes: number; adults: Set<string> }>) =>
    [...map.entries()]
      .map(([label, row]) => ({ label, minutes: row.minutes, volunteers: row.adults.size }))
      .sort((a, b) => b.minutes - a.minutes);

  return {
    schoolYear,
    totals,
    byEvent: sortedMinutes(byEvent),
    byCommittee: sortedMinutes(byCommittee),
    topVolunteers: [...byAdult.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 25),
    unfilledOpportunities,
    participationByMonth: [...byMonth.entries()]
      .map(([month, row]) => ({ month, minutes: row.minutes, volunteers: row.adults.size }))
      .sort((a, b) => a.month.localeCompare(b.month)),
  };
}
