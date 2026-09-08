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

const findFirstMeeting = vi.fn();
const findUniqueOrganization = vi.fn();
const findManyMeetingRsvp = vi.fn();
const findManyPtaMeetingRsvp = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: { findFirst: (...a: unknown[]) => findFirstMeeting(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    meetingRsvp: { findMany: (...a: unknown[]) => findManyMeetingRsvp(...a) },
    ptaMeetingRsvp: { findMany: (...a: unknown[]) => findManyPtaMeetingRsvp(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { GET } from "@/app/api/mobile/admin/meetings/[meetingId]/route";

function getRequest(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/api/mobile/admin/meetings/mtg-1?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function params(meetingId = "mtg-1") {
  return { params: Promise.resolve({ meetingId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
  findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
  findFirstMeeting.mockResolvedValue({ id: "mtg-1", title: "September General Meeting", meetingDate: new Date("2026-09-15T19:00:00Z"), location: "Library", status: "SCHEDULED" });
  findManyMeetingRsvp.mockResolvedValue([]);
  findManyPtaMeetingRsvp.mockResolvedValue([]);
});

describe("GET /api/mobile/admin/meetings/[meetingId]", () => {
  it("requires organizationId", async () => {
    const response = await GET(new Request("https://portal.test/api/mobile/admin/meetings/mtg-1", { headers: { Authorization: "Bearer x" } }), params());
    expect(response.status).toBe(400);
  });

  it("refuses a caller without the manageMeetings capability (e.g. a manageEvents-only admin) before touching any data", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["adminDashboard", "manageEvents"] });

    const response = await GET(getRequest(), params());
    expect(response.status).toBe(403);
    expect(findFirstMeeting).not.toHaveBeenCalled();
    expect(findManyMeetingRsvp).not.toHaveBeenCalled();
    expect(findManyPtaMeetingRsvp).not.toHaveBeenCalled();
  });

  it("refuses a parent/member persona with no admin capabilities at all", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const response = await GET(getRequest(), params());
    expect(response.status).toBe(403);
    expect(findFirstMeeting).not.toHaveBeenCalled();
  });

  it("returns 404 for a meeting belonging to a different organization -- never leaks cross-tenant existence, never aggregates", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageMeetings"] });
    findFirstMeeting.mockResolvedValue(null);

    const response = await GET(getRequest("organizationId=org-a"), params("mtg-other"));
    expect(response.status).toBe(404);
    expect(findFirstMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "mtg-other", organizationId: "org-a" } })
    );
    expect(findManyMeetingRsvp).not.toHaveBeenCalled();
    expect(findManyPtaMeetingRsvp).not.toHaveBeenCalled();
  });

  it("returns the meeting with the individual-mode RSVP view for a Community/Church/Union org", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageMeetings"] });
    findManyMeetingRsvp.mockResolvedValue([
      { id: "r-1", status: "GOING", updatedAt: new Date("2026-09-06T10:00:00Z"), orgMember: { id: "m-1", firstName: "Dana", lastName: "Whitfield" } },
      { id: "r-2", status: "NOT_GOING", updatedAt: new Date("2026-09-06T11:00:00Z"), orgMember: { id: "m-2", firstName: "Ray", lastName: "Okafor" } },
    ]);

    const response = await GET(getRequest(), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.title).toBe("September General Meeting");
    expect(body.data.rsvp.mode).toBe("individual");
    expect(body.data.rsvp.summary).toEqual({ totalResponses: 2, going: 1, maybe: 0, notGoing: 1, totalAttendees: 1 });
    expect(body.data.rsvp.responses[0]).toMatchObject({ name: "Dana Whitfield", status: "GOING", attendeeCount: null });
    // Names only — no contact fields ride along.
    expect(JSON.stringify(body.data.rsvp.responses)).not.toMatch(/email|phone|address/i);
  });

  it("returns the household-mode RSVP view with guest math for a PTA org", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageMeetings"] });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });
    findManyPtaMeetingRsvp.mockResolvedValue([
      { id: "r-1", status: "GOING", attendeeCount: 4, updatedAt: new Date("2026-09-06T10:00:00Z"), household: { id: "hh-1", displayName: "The Alvarez Family" } },
      { id: "r-2", status: "MAYBE", attendeeCount: 3, updatedAt: new Date("2026-09-06T11:00:00Z"), household: { id: "hh-2", displayName: "The Kim Family" } },
    ]);

    const response = await GET(getRequest(), params());
    const body = await response.json();

    expect(body.data.rsvp.mode).toBe("household");
    expect(body.data.rsvp.guestCounts).toBe(true);
    // A MAYBE household's 3 attendees are never expected attendance.
    expect(body.data.rsvp.summary).toEqual({ totalResponses: 2, going: 1, maybe: 1, notGoing: 0, totalAttendees: 4 });
    expect(body.data.rsvp.responses[0]).toMatchObject({ name: "The Alvarez Family", attendeeCount: 4 });
  });

  it("returns mode none with no responses for an HOA org", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageMeetings"] });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });

    const response = await GET(getRequest(), params());
    const body = await response.json();

    expect(body.data.rsvp).toEqual({ mode: "none", guestCounts: false, summary: null, responses: [] });
    expect(findManyMeetingRsvp).not.toHaveBeenCalled();
    expect(findManyPtaMeetingRsvp).not.toHaveBeenCalled();
  });
});
