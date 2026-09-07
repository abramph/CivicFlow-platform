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
  requireMobileAdminAccess: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

const findManyEvent = vi.fn();
const createEventPrisma = vi.fn();
const findUniqueOrganization = vi.fn();
const groupByEventRsvp = vi.fn();
const groupByPtaEventRsvp = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: (...a: unknown[]) => findManyEvent(...a), create: (...a: unknown[]) => createEventPrisma(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    eventRsvp: { groupBy: (...a: unknown[]) => groupByEventRsvp(...a) },
    ptaEventRsvp: { groupBy: (...a: unknown[]) => groupByPtaEventRsvp(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/mobile/admin/events/route";

function listRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/events?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}

function createRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
  groupByEventRsvp.mockResolvedValue([]);
  groupByPtaEventRsvp.mockResolvedValue([]);
});

describe("GET /api/mobile/admin/events", () => {
  it("requires organizationId", async () => {
    const response = await GET(new Request("https://portal.test/api/mobile/admin/events", { headers: { Authorization: "Bearer x" } }));
    expect(response.status).toBe(400);
  });

  it("returns 403 without manageEvents", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard"] });

    const response = await GET(listRequest());
    expect(response.status).toBe(403);
    expect(findManyEvent).not.toHaveBeenCalled();
  });

  it("lists events scoped to the requested organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findManyEvent.mockResolvedValueOnce([{ id: "evt-1", title: "Fall Festival" }]);

    const response = await GET(listRequest("organizationId=org-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findManyEvent).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
    // Rows now carry the additive compact planning summary; with no RSVP
    // rows in the org this is the explicit zero state, not a missing field.
    expect(body.data).toEqual([
      {
        id: "evt-1",
        title: "Fall Festival",
        rsvp: { guestCounts: false, totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 },
      },
    ]);
  });

  it("aggregates household guest counts per row for a PTA organization -- one batched groupBy, attendees never row counts", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });
    findManyEvent.mockResolvedValueOnce([
      { id: "evt-1", title: "Fall Festival" },
      { id: "evt-2", title: "Book Fair" },
    ]);
    groupByPtaEventRsvp.mockResolvedValueOnce([
      { eventId: "evt-1", status: "GOING", _count: { _all: 2 }, _sum: { attendeeCount: 7 } },
      { eventId: "evt-1", status: "MAYBE", _count: { _all: 1 }, _sum: { attendeeCount: 2 } },
      { eventId: "evt-1", status: "NOT_GOING", _count: { _all: 1 }, _sum: { attendeeCount: 1 } },
    ]);

    const response = await GET(listRequest("organizationId=org-a"));
    const body = await response.json();

    expect(groupByPtaEventRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", eventId: { in: ["evt-1", "evt-2"] } } })
    );
    // 2 GOING households represent 7 expected attendees (guests included).
    expect(body.data[0].rsvp).toEqual({ guestCounts: true, totalResponses: 4, going: 2, maybe: 1, notGoing: 1, totalAttendees: 7 });
    // Second event has no responses -- explicit zeros.
    expect(body.data[1].rsvp).toEqual({ guestCounts: true, totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 });
    expect(groupByEventRsvp).not.toHaveBeenCalled();
  });

  it("returns rsvp: null for an HOA organization (mode none) and never queries RSVP tables", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });
    findManyEvent.mockResolvedValueOnce([{ id: "evt-1", title: "Board Meeting" }]);

    const response = await GET(listRequest("organizationId=org-a"));
    const body = await response.json();

    expect(body.data[0].rsvp).toBeNull();
    expect(groupByEventRsvp).not.toHaveBeenCalled();
    expect(groupByPtaEventRsvp).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/admin/events", () => {
  it("rejects a crafted organizationId with no real capability, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    await POST(createRequest({ organizationId: "org-victim", title: "Party", status: "upcoming" }));

    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(createEventPrisma).not.toHaveBeenCalled();
  });

  it("rejects a missing title with 400 before checking capabilities", async () => {
    const response = await POST(createRequest({ organizationId: "org-a", status: "upcoming" }));
    expect(response.status).toBe(400);
    expect(resolveMobileAdminCapabilities).not.toHaveBeenCalled();
  });

  it("creates an event using the same createEvent() service the web form uses", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    createEventPrisma.mockResolvedValueOnce({ id: "evt-new", organizationId: "org-a", title: "Fall Festival", status: "upcoming" });

    const response = await POST(createRequest({ organizationId: "org-a", title: "Fall Festival", status: "upcoming" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("evt-new");
    expect(createEventPrisma).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", title: "Fall Festival" }) }));
  });

  it("rejects an end time before the start time", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });

    const response = await POST(
      createRequest({
        organizationId: "org-a",
        title: "Fall Festival",
        status: "upcoming",
        startAt: "2026-09-01T18:00:00.000Z",
        endAt: "2026-09-01T17:00:00.000Z",
      })
    );

    expect(response.status).toBe(400);
    expect(createEventPrisma).not.toHaveBeenCalled();
  });
});
