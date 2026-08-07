import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileAuth = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const resolveMobileAdminCapabilities = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  resolveMobileAdminCapabilities: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

const listPendingPtaVolunteerHourEntries = vi.fn();
vi.mock("@/lib/labs/pta/volunteers", () => ({
  listPendingPtaVolunteerHourEntries: (...args: unknown[]) => listPendingPtaVolunteerHourEntries(...args),
}));

const groupByOrgMember = vi.fn();
const countOrgMember = vi.fn();
const findManyConversationParticipant = vi.fn();
const countEvent = vi.fn();
const countCommunicationCampaign = vi.fn();
const countMeetingAttendanceSession = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { groupBy: (...args: unknown[]) => groupByOrgMember(...args), count: (...args: unknown[]) => countOrgMember(...args) },
    conversationParticipant: { findMany: (...args: unknown[]) => findManyConversationParticipant(...args) },
    event: { count: (...args: unknown[]) => countEvent(...args) },
    communicationCampaign: { count: (...args: unknown[]) => countCommunicationCampaign(...args) },
    meetingAttendanceSession: { count: (...args: unknown[]) => countMeetingAttendanceSession(...args) },
  },
}));

import { GET } from "@/app/api/mobile/admin/dashboard/route";

function request(organizationId = "org-a") {
  return new Request(`https://portal.test/api/mobile/admin/dashboard?organizationId=${organizationId}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

beforeEach(() => {
  requireMobileAuth.mockReset();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  resolveMobileAdminCapabilities.mockReset();
  listPendingPtaVolunteerHourEntries.mockReset();
  groupByOrgMember.mockReset();
  countOrgMember.mockReset();
  findManyConversationParticipant.mockReset();
  countEvent.mockReset();
  countCommunicationCampaign.mockReset().mockResolvedValue(0);
  countMeetingAttendanceSession.mockReset().mockResolvedValue(0);
});

describe("GET /api/mobile/admin/dashboard", () => {
  it("requires organizationId", async () => {
    const response = await GET(new Request("https://portal.test/api/mobile/admin/dashboard", { headers: { Authorization: "Bearer x" } }));
    expect(response.status).toBe(400);
  });

  it("returns 403 when the caller has no admin capabilities for this org", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(groupByOrgMember).not.toHaveBeenCalled();
  });

  it("includes member counts only when manageMembers is held, sourced from real OrgMember data", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["adminDashboard", "manageMembers"] });
    groupByOrgMember.mockResolvedValueOnce([
      { membershipStatus: "active", _count: { id: 42 } },
      { membershipStatus: "terminated", _count: { id: 3 } },
    ]);
    countOrgMember.mockResolvedValueOnce(7); // delinquent count

    const response = await GET(request());
    const body = await response.json();

    const byKey = Object.fromEntries(body.data.metrics.map((m: { key: string; value: number }) => [m.key, m.value]));
    expect(byKey.membersActive).toBe(42);
    expect(byKey.membersDelinquent).toBe(7);
    expect(byKey.membersInactive).toBe(0);
    expect(byKey.membersTerminated).toBe(3);
  });

  it("omits every metric group the caller doesn't hold the permission for", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageEvents"] });
    countEvent.mockResolvedValueOnce(5);

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.metrics).toEqual([{ key: "eventsUpcoming", label: "Upcoming Events", value: 5, href: "/admin-events" }]);
    expect(groupByOrgMember).not.toHaveBeenCalled();
    expect(listPendingPtaVolunteerHourEntries).not.toHaveBeenCalled();
    expect(findManyConversationParticipant).not.toHaveBeenCalled();
  });

  it("adds a needsAttention item with a real deep-link for pending PTA volunteer-hour approvals", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "managePtaVolunteers"] });
    listPendingPtaVolunteerHourEntries.mockResolvedValueOnce([{ id: "entry-1" }, { id: "entry-2" }]);

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.needsAttention).toEqual([
      { id: "pta-pending-hour-approvals", label: "2 volunteer hour submissions awaiting approval", href: "/volunteer-hour-approvals" },
    ]);
  });

  it("computes unread inbox count using the same hasUnread predicate as the conversations route, scoped to the caller's own userId", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageCommunications"] });
    findManyConversationParticipant.mockResolvedValueOnce([
      { lastReadAt: null, conversation: { lastMessageAt: new Date("2026-01-02") } }, // unread
      { lastReadAt: new Date("2026-01-05"), conversation: { lastMessageAt: new Date("2026-01-01") } }, // read
      { lastReadAt: new Date("2026-01-01"), conversation: { lastMessageAt: new Date("2026-01-03") } }, // unread
      { lastReadAt: null, conversation: { lastMessageAt: null } }, // no message yet, never unread
    ]);

    const response = await GET(request());
    const body = await response.json();

    expect(findManyConversationParticipant).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", organizationId: "org-a" } })
    );
    const inboxMetric = body.data.metrics.find((m: { key: string }) => m.key === "inboxUnread");
    expect(inboxMetric.value).toBe(2);
    expect(body.data.needsAttention).toEqual(
      expect.arrayContaining([{ id: "inbox-unread", label: "2 unread conversations", href: "/inbox" }])
    );
  });

  it("does not add a needsAttention entry for a zero count", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "managePtaVolunteers"] });
    listPendingPtaVolunteerHourEntries.mockResolvedValueOnce([]);

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.needsAttention).toEqual([]);
  });

  it("includes a campaigns metric alongside inbox when manageCommunications is held", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageCommunications"] });
    findManyConversationParticipant.mockResolvedValueOnce([]);
    countCommunicationCampaign.mockResolvedValueOnce(7);

    const response = await GET(request());
    const body = await response.json();

    const campaignsMetric = body.data.metrics.find((m: { key: string }) => m.key === "campaigns");
    expect(campaignsMetric).toEqual({ key: "campaigns", label: "Campaigns", value: 7, href: "/admin-campaigns" });
  });

  it("includes an open-check-in-sessions metric and needsAttention entry when manageAttendance is held", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageAttendance"] });
    countMeetingAttendanceSession.mockResolvedValueOnce(2);

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.metrics).toEqual([{ key: "attendanceSessionsOpen", label: "Open Check-In Sessions", value: 2, href: "/admin-events" }]);
    expect(body.data.needsAttention).toEqual(
      expect.arrayContaining([{ id: "attendance-sessions-open", label: "2 check-in sessions currently open", href: "/admin-events" }])
    );
  });

  it("omits the attendance metric group entirely without manageAttendance", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard"] });

    await GET(request());

    expect(countMeetingAttendanceSession).not.toHaveBeenCalled();
  });

  it("always returns generatedAt", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard"] });

    const response = await GET(request());
    const body = await response.json();

    expect(typeof body.data.generatedAt).toBe("string");
  });
});
