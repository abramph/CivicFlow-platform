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

const findFirstEvent = vi.fn();
const updateEventPrisma = vi.fn();
const findUniqueOrganization = vi.fn();
const findManyEventRsvp = vi.fn();
const findManyPtaEventRsvp = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a), update: (...a: unknown[]) => updateEventPrisma(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    eventRsvp: { findMany: (...a: unknown[]) => findManyEventRsvp(...a) },
    ptaEventRsvp: { findMany: (...a: unknown[]) => findManyPtaEventRsvp(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, PATCH } from "@/app/api/mobile/admin/events/[eventId]/route";

function getRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/events/evt-1?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function patchRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/mobile/admin/events/evt-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ eventId: "evt-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  // Default org shape for the RSVP view; individual tests override.
  findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
  findManyEventRsvp.mockResolvedValue([]);
  findManyPtaEventRsvp.mockResolvedValue([]);
});

describe("GET /api/mobile/admin/events/[eventId]", () => {
  it("returns 404 for an event belonging to a different organization -- never leaks cross-tenant existence", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await GET(getRequest("organizationId=org-a"), params());
    expect(response.status).toBe(404);
    expect(findFirstEvent).toHaveBeenCalledWith({ where: { id: "evt-1", organizationId: "org-a" } });
    // The RSVP view is never assembled for an event outside the caller's org.
    expect(findManyEventRsvp).not.toHaveBeenCalled();
    expect(findManyPtaEventRsvp).not.toHaveBeenCalled();
  });

  it("returns the event scoped to the requested organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    // Not ...Once: the RSVP view's list service re-verifies event tenancy
    // with its own findFirst call.
    findFirstEvent.mockResolvedValue({ id: "evt-1", title: "Fall Festival" });

    const response = await GET(getRequest(), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.title).toBe("Fall Festival");
  });

  it("refuses a caller without the manageEvents capability before touching any RSVP or event data", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageAttendance"] });

    const response = await GET(getRequest(), params());
    expect(response.status).toBe(403);
    expect(findFirstEvent).not.toHaveBeenCalled();
    expect(findManyEventRsvp).not.toHaveBeenCalled();
    expect(findManyPtaEventRsvp).not.toHaveBeenCalled();
  });

  it("attaches the household RSVP view for a PTA organization -- reusing the existing PTA services' rows and attendee math", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    // The PTA services re-verify event tenancy themselves, so findFirst is
    // hit more than once on this path.
    findFirstEvent.mockResolvedValue({ id: "evt-1", organizationId: "org-a", title: "Fall Festival" });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });
    findManyPtaEventRsvp.mockResolvedValue([
      { id: "rsvp-1", status: "GOING", attendeeCount: 3, updatedAt: new Date("2026-09-05T12:00:00Z"), household: { id: "hh-1", displayName: "The Alvarez Family" } },
      { id: "rsvp-2", status: "MAYBE", attendeeCount: 2, updatedAt: new Date("2026-09-05T13:00:00Z"), household: { id: "hh-2", displayName: "The Kim Family" } },
      { id: "rsvp-3", status: "NOT_GOING", attendeeCount: 1, updatedAt: new Date("2026-09-05T14:00:00Z"), household: { id: "hh-3", displayName: "The Osei Family" } },
    ]);

    const response = await GET(getRequest(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.rsvp.mode).toBe("household");
    expect(body.data.rsvp.guestCounts).toBe(true);
    // totalAttendees counts GOING households' attendeeCount only (guests
    // included) -- the documented cross-vertical attendee rule.
    expect(body.data.rsvp.summary).toEqual({ totalResponses: 3, going: 1, maybe: 1, notGoing: 1, totalAttendees: 3 });
    expect(body.data.rsvp.responses).toHaveLength(3);
    expect(body.data.rsvp.responses[0]).toMatchObject({ name: "The Alvarez Family", status: "GOING", attendeeCount: 3 });
  });

  it("attaches the individual RSVP view for a Community organization -- one response is one attendee, no guest counts", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValue({ id: "evt-1", organizationId: "org-a", title: "Cleanup Day" });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findManyEventRsvp.mockResolvedValue([
      { id: "rsvp-1", status: "GOING", updatedAt: new Date("2026-09-05T12:00:00Z"), orgMember: { id: "m-1", firstName: "Dana", lastName: "Whitfield" } },
      { id: "rsvp-2", status: "NOT_GOING", updatedAt: new Date("2026-09-05T13:00:00Z"), orgMember: { id: "m-2", firstName: "Ray", lastName: "Okafor" } },
    ]);

    const response = await GET(getRequest(), params());
    const body = await response.json();

    expect(body.data.rsvp.mode).toBe("individual");
    expect(body.data.rsvp.guestCounts).toBe(false);
    expect(body.data.rsvp.summary).toEqual({ totalResponses: 2, going: 1, maybe: 0, notGoing: 1, totalAttendees: 1 });
    expect(body.data.rsvp.responses[0]).toMatchObject({ name: "Dana Whitfield", status: "GOING", attendeeCount: null });
    expect(findManyPtaEventRsvp).not.toHaveBeenCalled();
  });

  it("returns mode none with no responses for an HOA organization -- RSVP data is never fetched", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValue({ id: "evt-1", organizationId: "org-a", title: "Board Meeting" });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });

    const response = await GET(getRequest(), params());
    const body = await response.json();

    expect(body.data.rsvp).toEqual({ mode: "none", guestCounts: false, summary: null, responses: [] });
    expect(findManyEventRsvp).not.toHaveBeenCalled();
    expect(findManyPtaEventRsvp).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/mobile/admin/events/[eventId]", () => {
  it("rejects a crafted organizationId, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await PATCH(patchRequest({ organizationId: "org-victim", status: "cancelled" }), params());
    expect(response.status).toBe(403);
    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(updateEventPrisma).not.toHaveBeenCalled();
  });

  it("cancels an event via status:cancelled -- no separate cancel route, matching the web CancelEventButton pattern", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValueOnce({ id: "evt-1", organizationId: "org-a", title: "Fall Festival", status: "upcoming", location: null });
    updateEventPrisma.mockResolvedValueOnce({ id: "evt-1", organizationId: "org-a", title: "Fall Festival", status: "cancelled", location: null });

    const response = await PATCH(patchRequest({ organizationId: "org-a", status: "cancelled" }), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("cancelled");
  });

  it("returns 404 when the event doesn't belong to the caller's organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageEvents"] });
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await PATCH(patchRequest({ organizationId: "org-a", title: "New title" }), params());
    expect(response.status).toBe(404);
  });
});
