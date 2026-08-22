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
  // requireMobileAdminAccess is the subscription-gated wrapper the route
  // now calls — delegate straight to the same mock so existing
  // resolveMobileAdminCapabilities setups keep driving these tests
  // unchanged (this suite isn't testing the billing gate itself).
  requireMobileAdminAccess: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
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
const countPaymentReport = vi.fn();
const countPaymentLinkOfflineReport = vi.fn();
const countPtaHousehold = vi.fn();
const countProperty = vi.fn();
const countViolation = vi.fn();
const countArchitecturalRequest = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { groupBy: (...args: unknown[]) => groupByOrgMember(...args), count: (...args: unknown[]) => countOrgMember(...args) },
    conversationParticipant: { findMany: (...args: unknown[]) => findManyConversationParticipant(...args) },
    event: { count: (...args: unknown[]) => countEvent(...args) },
    communicationCampaign: { count: (...args: unknown[]) => countCommunicationCampaign(...args) },
    meetingAttendanceSession: { count: (...args: unknown[]) => countMeetingAttendanceSession(...args) },
    paymentReport: { count: (...args: unknown[]) => countPaymentReport(...args) },
    paymentLinkOfflineReport: { count: (...args: unknown[]) => countPaymentLinkOfflineReport(...args) },
    ptaHousehold: { count: (...args: unknown[]) => countPtaHousehold(...args) },
    property: { count: (...args: unknown[]) => countProperty(...args) },
    violation: { count: (...args: unknown[]) => countViolation(...args) },
    architecturalRequest: { count: (...args: unknown[]) => countArchitecturalRequest(...args) },
  },
}));

const getMemberPaymentsFinancialSummary = vi.fn();
vi.mock("@/lib/financial-summary", () => ({
  getMemberPaymentsFinancialSummary: (...args: unknown[]) => getMemberPaymentsFinancialSummary(...args),
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
  countPaymentReport.mockReset().mockResolvedValue(0);
  countPaymentLinkOfflineReport.mockReset().mockResolvedValue(0);
  countPtaHousehold.mockReset().mockResolvedValue(0);
  countProperty.mockReset().mockResolvedValue(0);
  countViolation.mockReset().mockResolvedValue(0);
  countArchitecturalRequest.mockReset().mockResolvedValue(0);
  getMemberPaymentsFinancialSummary.mockReset().mockResolvedValue({
    totalDuesCollectedCents: 0,
    totalContributionsCents: 0,
    duesOutstandingCents: 0,
    duesCollected30dCents: 0,
  });
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

  it("includes formatted currency metrics and a needsAttention entry when managePayments is held with pending reports", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["adminDashboard", "managePayments"] });
    getMemberPaymentsFinancialSummary.mockResolvedValueOnce({
      totalDuesCollectedCents: 100000,
      totalContributionsCents: 30075,
      duesOutstandingCents: 5020,
      duesCollected30dCents: 2505,
    });
    countPaymentReport.mockResolvedValueOnce(2);
    countPaymentLinkOfflineReport.mockResolvedValueOnce(1);

    const response = await GET(request());
    const body = await response.json();

    const outstanding = body.data.metrics.find((m: { key: string }) => m.key === "duesOutstanding");
    expect(outstanding.value).toBe("$50.20");
    const pending = body.data.metrics.find((m: { key: string }) => m.key === "pendingPaymentReports");
    expect(pending.value).toBe(3);
    expect(body.data.needsAttention).toEqual(
      expect.arrayContaining([{ id: "pending-payment-reports", label: "3 self-reported payments awaiting review", href: "/admin-payment-reports" }])
    );
  });

  it("omits the payments metric group entirely without managePayments", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard"] });

    await GET(request());

    expect(getMemberPaymentsFinancialSummary).not.toHaveBeenCalled();
  });

  it("includes a Reports entry point when manageReports is held", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageReports"] });

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.metrics).toEqual([{ key: "reports", label: "Reports", value: "View", href: "/admin-reports" }]);
  });

  it("includes an active-households metric when managePtaHouseholds is held", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "managePtaHouseholds"] });
    countPtaHousehold.mockResolvedValueOnce(12);

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.metrics).toEqual([{ key: "ptaHouseholds", label: "Active Households", value: 12, href: "/admin-pta-households" }]);
    expect(countPtaHousehold).toHaveBeenCalledWith({ where: { organizationId: "org-a", status: "ACTIVE" } });
  });

  it("includes properties metric and a needsAttention entry for properties with no active resident when manageHoaProperties is held", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageHoaProperties"] });
    countProperty.mockResolvedValueOnce(50).mockResolvedValueOnce(3);

    const response = await GET(request());
    const body = await response.json();

    const propertiesMetric = body.data.metrics.find((m: { key: string }) => m.key === "hoaProperties");
    expect(propertiesMetric).toEqual({ key: "hoaProperties", label: "Active Properties", value: 50, href: "/admin-hoa-properties" });
    expect(body.data.needsAttention).toEqual(
      expect.arrayContaining([{ id: "hoa-properties-no-resident", label: "3 properties have no active resident", href: "/admin-hoa-properties?noActiveResident=true" }])
    );
  });

  it("includes an open-violations metric and needsAttention entry when manageHoaViolations is held", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageHoaViolations"] });
    countViolation.mockResolvedValueOnce(4);

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.metrics).toEqual([{ key: "hoaViolationsOpen", label: "Open Violations", value: 4, href: "/admin-hoa-violations" }]);
    expect(countViolation).toHaveBeenCalledWith({ where: { organizationId: "org-a", status: { in: ["ISSUED", "ACKNOWLEDGED", "IN_REVIEW"] } } });
    expect(body.data.needsAttention).toEqual(
      expect.arrayContaining([{ id: "hoa-violations-open", label: "4 violations open", href: "/admin-hoa-violations" }])
    );
  });

  it("includes a pending-architectural-requests metric and needsAttention entry when manageHoaArchitecturalRequests is held", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard", "manageHoaArchitecturalRequests"] });
    countArchitecturalRequest.mockResolvedValueOnce(1);

    const response = await GET(request());
    const body = await response.json();

    expect(body.data.metrics).toEqual([{ key: "hoaArchitecturalRequestsPending", label: "Requests Awaiting Review", value: 1, href: "/admin-hoa-architectural-requests" }]);
    expect(body.data.needsAttention).toEqual(
      expect.arrayContaining([{ id: "hoa-architectural-requests-pending", label: "1 architectural request awaiting review", href: "/admin-hoa-architectural-requests" }])
    );
  });

  it("omits all four new PR E metric groups without their respective capabilities", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard"] });

    await GET(request());

    expect(countPtaHousehold).not.toHaveBeenCalled();
    expect(countProperty).not.toHaveBeenCalled();
    expect(countViolation).not.toHaveBeenCalled();
    expect(countArchitecturalRequest).not.toHaveBeenCalled();
  });

  it("always returns generatedAt", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard"] });

    const response = await GET(request());
    const body = await response.json();

    expect(typeof body.data.generatedAt).toBe("string");
  });
});
