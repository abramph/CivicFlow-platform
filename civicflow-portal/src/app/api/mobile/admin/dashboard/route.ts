import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess, type AdminCapabilityFlag } from "@/lib/mobile-admin";
import { listPendingPtaVolunteerHourEntries } from "@/lib/labs/pta/volunteers";
import { getMemberPaymentsFinancialSummary } from "@/lib/financial-summary";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

function centsToCurrency(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

interface AdminMetric {
  key: string;
  label: string;
  /** A pre-formatted currency string (e.g. "$150.20") for money metrics -- the
   * client never re-derives currency formatting from a raw cents/dollar
   * number, avoiding a second place float/rounding logic could diverge. */
  value: number | string;
  /** Mobile deep-link (expo-router path) — omitted when no screen exists yet to show more detail. */
  href?: string;
}

interface NeedsAttentionItem {
  id: string;
  label: string;
  href: string;
}

/**
 * GET /api/mobile/admin/dashboard?organizationId=...
 *
 * Mobile Admin program (PR A) — the Admin tab's landing aggregation. Only
 * ever includes a metric when the caller actually holds the permission that
 * would let them act on it (mirrors the web dashboard's inline
 * permission-gated StatCard pattern) AND the organization's vertical
 * supports it. No fabricated zeroes for workflows that don't have a mobile
 * screen yet (member/event/payment/report admin land in PR B-D) — this
 * endpoint is designed for those PRs to each add their own metrics/
 * needsAttention entries here, not to invent a parallel aggregation.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await requireMobileAdminAccess(organizationId, userId);
    if (!admin.available) throw new MobileForbiddenError("No mobile admin access for this organization");

    const has = (flag: AdminCapabilityFlag) => admin.adminCapabilities.includes(flag);

    const metrics: AdminMetric[] = [];
    const needsAttention: NeedsAttentionItem[] = [];

    if (has("manageMembers")) {
      const breakdown = await prisma.orgMember.groupBy({
        by: ["membershipStatus"],
        where: { organizationId },
        _count: { id: true },
      });
      const byStatus = Object.fromEntries(breakdown.map((r) => [r.membershipStatus, r._count.id]));
      const delinquentCount = await prisma.orgMember.count({ where: { organizationId, isDelinquent: true } });

      metrics.push(
        { key: "membersActive", label: "Active Members", value: byStatus["active"] ?? 0, href: "/admin-members?membershipStatus=active" },
        { key: "membersDelinquent", label: "Delinquent", value: delinquentCount, href: "/admin-members?delinquency=delinquent" },
        { key: "membersInactive", label: "Inactive", value: byStatus["inactive"] ?? 0, href: "/admin-members?membershipStatus=inactive" },
        { key: "membersTerminated", label: "Terminated", value: byStatus["terminated"] ?? 0, href: "/admin-members?membershipStatus=terminated" }
      );
    }

    if (has("managePtaVolunteers")) {
      const pendingHourEntries = await listPendingPtaVolunteerHourEntries(organizationId);
      metrics.push({ key: "ptaPendingHourApprovals", label: "Volunteer Hours Awaiting Approval", value: pendingHourEntries.length, href: "/volunteer-hour-approvals" });
      if (pendingHourEntries.length > 0) {
        needsAttention.push({
          id: "pta-pending-hour-approvals",
          label: `${pendingHourEntries.length} volunteer hour submission${pendingHourEntries.length === 1 ? "" : "s"} awaiting approval`,
          href: "/volunteer-hour-approvals",
        });
      }
    }

    if (has("manageCommunications")) {
      // Mirrors the exact hasUnread predicate GET /api/mobile/messages/conversations
      // uses per participation — kept as a lightweight direct count here
      // rather than re-fetching full conversation payloads.
      const participations = await prisma.conversationParticipant.findMany({
        where: { userId, organizationId },
        select: { lastReadAt: true, conversation: { select: { lastMessageAt: true } } },
      });
      const unreadCount = participations.filter(
        (p) => p.conversation.lastMessageAt && (!p.lastReadAt || p.conversation.lastMessageAt > p.lastReadAt)
      ).length;

      metrics.push({ key: "inboxUnread", label: "Unread Conversations", value: unreadCount, href: "/inbox" });
      if (unreadCount > 0) {
        needsAttention.push({
          id: "inbox-unread",
          label: `${unreadCount} unread conversation${unreadCount === 1 ? "" : "s"}`,
          href: "/inbox",
        });
      }

      const campaignCount = await prisma.communicationCampaign.count({ where: { organizationId } });
      metrics.push({ key: "campaigns", label: "Campaigns", value: campaignCount, href: "/admin-campaigns" });
    }

    if (has("manageEvents")) {
      const upcomingEventsCount = await prisma.event.count({
        where: { organizationId, startAt: { gte: new Date() } },
      });
      metrics.push({ key: "eventsUpcoming", label: "Upcoming Events", value: upcomingEventsCount, href: "/admin-events" });
    }

    if (has("managePayments")) {
      const [financialSummary, pendingPaymentReports, pendingPaymentLinkReports] = await Promise.all([
        getMemberPaymentsFinancialSummary(organizationId),
        prisma.paymentReport.count({ where: { organizationId, status: "pending" } }),
        prisma.paymentLinkOfflineReport.count({ where: { organizationId, status: "pending" } }),
      ]);
      const pendingTotal = pendingPaymentReports + pendingPaymentLinkReports;

      metrics.push(
        { key: "duesOutstanding", label: "Dues Outstanding", value: centsToCurrency(financialSummary.duesOutstandingCents), href: "/admin-payments" },
        { key: "duesCollected30d", label: "Dues Collected (30d)", value: centsToCurrency(financialSummary.duesCollected30dCents), href: "/admin-payments" },
        { key: "pendingPaymentReports", label: "Pending Payment Reports", value: pendingTotal, href: "/admin-payment-reports" }
      );
      if (pendingTotal > 0) {
        needsAttention.push({
          id: "pending-payment-reports",
          label: `${pendingTotal} self-reported payment${pendingTotal === 1 ? "" : "s"} awaiting review`,
          href: "/admin-payment-reports",
        });
      }
    }

    if (has("manageReports")) {
      metrics.push({ key: "reports", label: "Reports", value: "View", href: "/admin-reports" });
    }

    if (has("manageAttendance")) {
      const openSessionCount = await prisma.meetingAttendanceSession.count({
        where: { organizationId, status: "OPEN" },
      });
      metrics.push({ key: "attendanceSessionsOpen", label: "Open Check-In Sessions", value: openSessionCount, href: "/admin-events" });
      if (openSessionCount > 0) {
        needsAttention.push({
          id: "attendance-sessions-open",
          label: `${openSessionCount} check-in session${openSessionCount === 1 ? "" : "s"} currently open`,
          href: "/admin-events",
        });
      }
    }

    if (has("managePtaHouseholds")) {
      const activeHouseholdCount = await prisma.ptaHousehold.count({ where: { organizationId, status: "ACTIVE" } });
      metrics.push({ key: "ptaHouseholds", label: "Active Households", value: activeHouseholdCount, href: "/admin-pta-households" });
    }

    if (has("manageHoaProperties")) {
      const [activePropertyCount, noActiveResidentCount] = await Promise.all([
        prisma.property.count({ where: { organizationId, status: "ACTIVE" } }),
        prisma.property.count({ where: { organizationId, status: "ACTIVE", residents: { none: { status: "ACTIVE" } } } }),
      ]);
      metrics.push({ key: "hoaProperties", label: "Active Properties", value: activePropertyCount, href: "/admin-hoa-properties" });
      if (noActiveResidentCount > 0) {
        needsAttention.push({
          id: "hoa-properties-no-resident",
          label: `${noActiveResidentCount} propert${noActiveResidentCount === 1 ? "y has" : "ies have"} no active resident`,
          href: "/admin-hoa-properties?noActiveResident=true",
        });
      }
    }

    if (has("manageHoaViolations")) {
      const openViolationCount = await prisma.violation.count({
        where: { organizationId, status: { in: ["ISSUED", "ACKNOWLEDGED", "IN_REVIEW"] } },
      });
      metrics.push({ key: "hoaViolationsOpen", label: "Open Violations", value: openViolationCount, href: "/admin-hoa-violations" });
      if (openViolationCount > 0) {
        needsAttention.push({
          id: "hoa-violations-open",
          label: `${openViolationCount} violation${openViolationCount === 1 ? "" : "s"} open`,
          href: "/admin-hoa-violations",
        });
      }
    }

    if (has("manageHoaArchitecturalRequests")) {
      const pendingRequestCount = await prisma.architecturalRequest.count({
        where: { organizationId, status: { in: ["SUBMITTED", "IN_REVIEW", "RESUBMITTED"] } },
      });
      metrics.push({ key: "hoaArchitecturalRequestsPending", label: "Requests Awaiting Review", value: pendingRequestCount, href: "/admin-hoa-architectural-requests" });
      if (pendingRequestCount > 0) {
        needsAttention.push({
          id: "hoa-architectural-requests-pending",
          label: `${pendingRequestCount} architectural request${pendingRequestCount === 1 ? "" : "s"} awaiting review`,
          href: "/admin-hoa-architectural-requests",
        });
      }
    }

    return Response.json({
      ok: true,
      data: { metrics, needsAttention, generatedAt: new Date().toISOString() },
    });
  });
}
