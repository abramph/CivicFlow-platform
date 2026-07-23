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
    prisma.meetingMinutesDraft.count({ where: { organizationId, status: "APPROVED", approvedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
  ]);

  const volunteerSlotsOpen = slots.reduce((sum, s) => sum + Math.max(0, s.capacity - s.claimedCount), 0);
  const volunteerSlotsFilled = slots.reduce((sum, s) => sum + s.claimedCount, 0);

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
  };
}
