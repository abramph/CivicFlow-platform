import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac";
import { computeReadiness, getOrgReadinessFacts, getTransitionDetail } from "./transitions";
import { deriveComplianceStatus } from "./compliance";

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

// ─── PTA Vertical 2.0, PR PTA-K: Dashboard 2.0 (§25) ─────────────────────────

export interface DashboardHealthItem {
  label: string;
  value: string;
  href?: string;
}

export interface DashboardUpcomingItem {
  date: Date;
  label: string;
  kind: "MEETING" | "EVENT" | "DEADLINE";
}

export interface DashboardAttentionItem {
  label: string;
  href: string;
}

export interface PtaDashboardV2 {
  greetingName: string | null;
  health: DashboardHealthItem[];
  upcoming: DashboardUpcomingItem[];
  needsAttention: DashboardAttentionItem[];
}

/**
 * §25's actionable header: PTA Health, Upcoming, Needs Attention. The §25
 * permission rule is enforced HERE — every section is guarded by the
 * viewer's `can`, so a metric the viewer may not see is never computed, let
 * alone rendered. Grievances appear at most as a permission-safe count of
 * open NON-restricted cases for pta:concerns:view holders — restricted
 * cases are excluded even from that number.
 */
export async function getPtaDashboardV2(
  organizationId: string,
  schoolYear: string,
  viewer: { userId: string; can: (permission: Permission) => boolean }
): Promise<PtaDashboardV2> {
  const now = new Date();
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const health: DashboardHealthItem[] = [];
  const upcoming: DashboardUpcomingItem[] = [];
  const needsAttention: DashboardAttentionItem[] = [];

  // Greeting: the viewer's own sitting board position, if they hold one.
  const myAssignment = await prisma.ptaOfficerAssignment.findFirst({
    where: { organizationId, status: "ACTIVE", householdAdult: { userId: viewer.userId } },
    include: { position: { select: { name: true } } },
  });
  const greetingName = myAssignment?.position.name ?? null;

  const [households, adults, upcomingEvents, upcomingMeetings] = await Promise.all([
    prisma.ptaHousehold.count({ where: { organizationId, schoolYear, status: "ACTIVE" } }),
    prisma.ptaHouseholdAdult.count({ where: { organizationId } }),
    prisma.event.findMany({
      where: { organizationId, startAt: { gte: now, lte: in60Days } },
      orderBy: { startAt: "asc" },
      select: { title: true, startAt: true },
      take: 10,
    }),
    prisma.meeting.findMany({
      where: { organizationId, meetingDate: { gte: now, lte: in60Days } },
      orderBy: { meetingDate: "asc" },
      select: { title: true, meetingDate: true },
      take: 10,
    }),
  ]);
  health.push({ label: "Households", value: String(households), href: "/labs/pta/households" });
  health.push({ label: "Adults", value: String(adults) });
  for (const meeting of upcomingMeetings) upcoming.push({ date: meeting.meetingDate, label: meeting.title, kind: "MEETING" });
  for (const event of upcomingEvents) if (event.startAt) upcoming.push({ date: event.startAt, label: event.title, kind: "EVENT" });

  // Volunteer needs — open spots on OPEN upcoming-or-undated opportunities.
  const openOpportunities = await prisma.ptaVolunteerOpportunity.findMany({
    where: { organizationId, status: "OPEN", OR: [{ startAt: null }, { startAt: { gte: now } }] },
    include: { slots: { where: { status: "OPEN" }, select: { capacity: true, claimedCount: true } } },
  });
  let openSpots = 0;
  let shortOpportunities = 0;
  for (const opportunity of openOpportunities) {
    const spots = opportunity.slots.reduce((sum, slot) => sum + Math.max(0, slot.capacity - slot.claimedCount), 0);
    if (spots > 0) {
      openSpots += spots;
      shortOpportunities += 1;
    }
  }
  health.push({ label: "Volunteer needs", value: String(openSpots), href: "/labs/pta/volunteers/reports" });
  if (openSpots > 0) {
    needsAttention.push({
      label: `${openSpots} open volunteer spot${openSpots === 1 ? "" : "s"} across ${shortOpportunities} opportunit${shortOpportunities === 1 ? "y" : "ies"}`,
      href: "/labs/pta/volunteers/manage",
    });
  }
  health.push({ label: "Upcoming events", value: String(upcomingEvents.length), href: "/labs/pta/events" });

  if (viewer.can("pta:board:view")) {
    const positions = await prisma.ptaBoardPosition.findMany({
      where: { organizationId, isActive: true },
      include: { assignments: { where: { status: "ACTIVE" }, take: 1, select: { id: true } } },
    });
    const filled = positions.filter((position) => position.assignments.length > 0).length;
    health.push({ label: "Board positions filled", value: `${filled}/${positions.length}`, href: "/labs/pta/board" });

    const activeTransition = await prisma.ptaBoardTransition.findFirst({
      where: { organizationId, status: { not: "COMPLETED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (activeTransition) {
      const detail = await getTransitionDetail(organizationId, activeTransition.id);
      const readiness = computeReadiness(detail, await getOrgReadinessFacts(organizationId));
      health.push({ label: "Transition readiness", value: `${readiness.score}%`, href: "/labs/pta/transition" });
      const unaccepted = detail.handoffs.filter((handoff) => handoff.status !== "ACCEPTED");
      if (unaccepted.length > 0 && unaccepted.length <= 3) {
        for (const handoff of unaccepted) {
          needsAttention.push({ label: `${handoff.position.name} transition incomplete`, href: "/labs/pta/transition" });
        }
      } else if (unaccepted.length > 3) {
        needsAttention.push({ label: `${unaccepted.length} officer handoffs not yet accepted`, href: "/labs/pta/transition" });
      }
    }

    const requirements = await prisma.ptaComplianceRequirement.findMany({ where: { organizationId, isApplicable: true } });
    let dueSoon = 0;
    let overdue = 0;
    for (const requirement of requirements) {
      const status = deriveComplianceStatus(requirement, now);
      if (status === "DUE_SOON") {
        dueSoon += 1;
        const days = requirement.dueDate ? Math.ceil((requirement.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : 0;
        needsAttention.push({ label: `${requirement.title} due in ${days} day${days === 1 ? "" : "s"}`, href: "/labs/pta/compliance" });
        if (requirement.dueDate) upcoming.push({ date: requirement.dueDate, label: `${requirement.title} due`, kind: "DEADLINE" });
      } else if (status === "OVERDUE") {
        overdue += 1;
        needsAttention.push({ label: `${requirement.title} is overdue`, href: "/labs/pta/compliance" });
      }
    }
    health.push({
      label: "Compliance",
      value: overdue > 0 ? `${overdue} overdue` : dueSoon > 0 ? `${dueSoon} due soon` : "On track",
      href: "/labs/pta/compliance",
    });
  }

  if (viewer.can("meetings:read")) {
    const [openItems, overdueItems] = await Promise.all([
      prisma.meetingActionItem.count({ where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } } }),
      prisma.meetingActionItem.count({
        where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] }, dueDate: { lt: now } },
      }),
    ]);
    health.push({ label: "Open action items", value: String(openItems), href: "/meetings/decisions" });
    if (overdueItems > 0) {
      health.push({ label: "Overdue actions", value: String(overdueItems), href: "/meetings/decisions" });
      needsAttention.push({ label: `${overdueItems} overdue action item${overdueItems === 1 ? "" : "s"}`, href: "/meetings/decisions" });
    }
  }

  if (viewer.can("reimbursements:manage")) {
    const pending = await prisma.reimbursementRequest.count({ where: { organizationId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } });
    if (pending > 0) {
      needsAttention.push({ label: `${pending} reimbursement${pending === 1 ? "" : "s"} awaiting review`, href: "/labs/pta/finance" });
    }
  }

  // §25's grievance rule: a permission-safe count only, restricted cases
  // excluded even from the number.
  if (viewer.can("pta:concerns:view")) {
    const openConcerns = await prisma.ptaConcern.count({
      where: { organizationId, isRestricted: false, status: { notIn: ["RESOLVED", "DISMISSED", "CLOSED"] } },
    });
    if (openConcerns > 0) {
      needsAttention.push({ label: `${openConcerns} open concern case${openConcerns === 1 ? "" : "s"}`, href: "/labs/pta/concerns" });
    }
  }

  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());

  return { greetingName, health, upcoming: upcoming.slice(0, 8), needsAttention };
}
