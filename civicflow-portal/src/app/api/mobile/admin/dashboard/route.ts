import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities, type AdminCapabilityFlag } from "@/lib/mobile-admin";
import { listPendingPtaVolunteerHourEntries } from "@/lib/labs/pta/volunteers";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

interface AdminMetric {
  key: string;
  label: string;
  value: number;
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
    const admin = await resolveMobileAdminCapabilities(organizationId, userId);
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
        { key: "membersActive", label: "Active Members", value: byStatus["active"] ?? 0 },
        { key: "membersDelinquent", label: "Delinquent", value: delinquentCount },
        { key: "membersInactive", label: "Inactive", value: byStatus["inactive"] ?? 0 },
        { key: "membersTerminated", label: "Terminated", value: byStatus["terminated"] ?? 0 }
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
    }

    if (has("manageEvents")) {
      const upcomingEventsCount = await prisma.event.count({
        where: { organizationId, startAt: { gte: new Date() } },
      });
      metrics.push({ key: "eventsUpcoming", label: "Upcoming Events", value: upcomingEventsCount, href: "/events" });
    }

    return Response.json({
      ok: true,
      data: { metrics, needsAttention, generatedAt: new Date().toISOString() },
    });
  });
}
