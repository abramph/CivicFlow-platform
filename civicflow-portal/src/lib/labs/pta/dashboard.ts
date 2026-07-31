import { prisma } from "@/lib/prisma";

/**
 * All metrics here are tenant-scoped counts/sums only — never a student name,
 * never a household directory listing. Mirrors the "hand-picked shape, never
 * a raw Prisma record" convention from platform-operations/*.ts.
 */
export interface PtaDashboardMetrics {
  activeHouseholds: number;
  membershipGoal: number | null;
  paidHouseholds: number;
  unpaidHouseholds: number;
  upcomingEventsCount: number;
  volunteerSlotsOpen: number;
  volunteerSlotsFilled: number;
  volunteerHoursLogged: number;
  activeFundraisingCampaigns: number;
  amountRaisedCents: number;
  recentAnnouncementsCount: number;
  upcomingMeetingTitle: string | null;
  upcomingMeetingDate: string | null;
  recentlyApprovedMinutesCount: number;
  committeesCount: number;
  teachersCount: number;
  pendingPaymentReportsCount: number;
  outstandingDuesCents: number;
  approvedVolunteerMinutes: number;
  pendingVolunteerHourApprovals: number;
  understaffedShiftsCount: number;
}

export async function getPtaDashboardMetrics(organizationId: string, schoolYear: string): Promise<PtaDashboardMetrics> {
  const [
    activeHouseholds,
    paidHouseholds,
    unpaidHouseholds,
    upcomingEventsCount,
    slots,
    volunteerHours,
    campaigns,
    contributionSum,
    recentAnnouncementsCount,
    upcomingMeeting,
    recentlyApprovedMinutesCount,
    committeesCount,
    teachersCount,
    pendingPaymentReportsCount,
    outstandingCharges,
    approvedVolunteerHours,
    pendingVolunteerHourApprovals,
    slotsWithMinimums,
  ] = await Promise.all([
    prisma.ptaHousehold.count({ where: { organizationId, schoolYear, status: "ACTIVE" } }),
    prisma.ptaHousehold.count({ where: { organizationId, schoolYear, status: "ACTIVE", orgMember: { duesCharges: { some: { organizationId, status: "PAID" } } } } }),
    prisma.ptaHousehold.count({ where: { organizationId, schoolYear, status: "ACTIVE", orgMember: { duesCharges: { some: { organizationId, status: { in: ["PENDING", "PARTIAL"] } } } } } }),
    prisma.event.count({ where: { organizationId, startAt: { gte: new Date() } } }),
    prisma.ptaVolunteerSlot.findMany({ where: { organizationId }, select: { capacity: true, claimedCount: true } }),
    prisma.ptaVolunteerSignup.aggregate({ where: { organizationId, status: "COMPLETED" }, _sum: { hoursLogged: true } }),
    prisma.campaign.count({ where: { organizationId, status: "active" } }),
    prisma.contribution.aggregate({ where: { organizationId }, _sum: { amount: true } }),
    prisma.communicationCampaign.count({ where: { organizationId, status: "SENT", createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
    prisma.meeting.findFirst({ where: { organizationId, meetingDate: { gte: new Date() } }, orderBy: { meetingDate: "asc" }, select: { title: true, meetingDate: true } }),
    // Previously queried MeetingMinutesDraft (the internal-only, AI-generation
    // Meeting Intelligence model) -- always 0 for a real customer org, since
    // that feature is never enabled outside the internal pilot. This is the
    // general minutes-approval workflow instead (src/lib/meeting-minutes.ts),
    // available to every organization.
    prisma.meetingMinutes.count({ where: { organizationId, status: "APPROVED", approvedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
    prisma.ptaCommittee.count({ where: { organizationId } }),
    prisma.ptaTeacher.count({ where: { organizationId } }),
    prisma.paymentReport.count({ where: { organizationId, status: "pending", member: { ptaHouseholdBilling: { isNot: null } } } }),
    prisma.duesCharge.findMany({
      where: { organizationId, status: { in: ["PENDING", "PARTIAL"] }, member: { ptaHouseholdBilling: { isNot: null } } },
      select: { amountDue: true, amountPaid: true },
    }),
    prisma.ptaVolunteerHourEntry.aggregate({ where: { organizationId, schoolYear, status: "APPROVED" }, _sum: { creditedMinutes: true } }),
    prisma.ptaVolunteerHourEntry.count({ where: { organizationId, schoolYear, status: "PENDING" } }),
    prisma.ptaVolunteerSlot.findMany({ where: { organizationId, minNeeded: { not: null } }, select: { capacity: true, claimedCount: true, minNeeded: true } }),
  ]);

  const volunteerSlotsOpen = slots.reduce((sum, s) => sum + Math.max(0, s.capacity - s.claimedCount), 0);
  const volunteerSlotsFilled = slots.reduce((sum, s) => sum + s.claimedCount, 0);
  const outstandingDuesCents = outstandingCharges.reduce(
    (sum, c) => sum + Math.round((Number(c.amountDue) - Number(c.amountPaid)) * 100),
    0
  );
  const understaffedShiftsCount = slotsWithMinimums.filter((s) => s.minNeeded !== null && s.claimedCount < s.minNeeded).length;

  return {
    activeHouseholds,
    // No explicit membership-goal field exists on PtaProfile yet — reserved for a future setting.
    membershipGoal: null,
    paidHouseholds,
    unpaidHouseholds,
    upcomingEventsCount,
    volunteerSlotsOpen,
    volunteerSlotsFilled,
    volunteerHoursLogged: volunteerHours._sum.hoursLogged ?? 0,
    activeFundraisingCampaigns: campaigns,
    amountRaisedCents: Math.round(Number(contributionSum._sum.amount ?? 0) * 100),
    recentAnnouncementsCount,
    upcomingMeetingTitle: upcomingMeeting?.title ?? null,
    upcomingMeetingDate: upcomingMeeting?.meetingDate?.toISOString() ?? null,
    recentlyApprovedMinutesCount,
    committeesCount,
    teachersCount,
    pendingPaymentReportsCount,
    outstandingDuesCents,
    approvedVolunteerMinutes: approvedVolunteerHours._sum.creditedMinutes ?? 0,
    pendingVolunteerHourApprovals,
    understaffedShiftsCount,
  };
}
