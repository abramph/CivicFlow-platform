import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobilePtaHouseholdAccess = vi.fn();
const requireMobileOrgAccess = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobilePtaHouseholdAccess: (...args: unknown[]) => requireMobilePtaHouseholdAccess(...args),
  requireMobileOrgAccess: (...args: unknown[]) => requireMobileOrgAccess(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const getPtaParentDuesSummary = vi.fn();
const reportPtaDuesPayment = vi.fn();
vi.mock("@/lib/labs/pta/parent-dues", () => ({
  getPtaParentDuesSummary: (...args: unknown[]) => getPtaParentDuesSummary(...args),
  reportPtaDuesPayment: (...args: unknown[]) => reportPtaDuesPayment(...args),
}));

const setPtaEventRsvp = vi.fn();
vi.mock("@/lib/labs/pta/events", () => ({
  setPtaEventRsvp: (...args: unknown[]) => setPtaEventRsvp(...args),
}));

const setPtaMeetingRsvp = vi.fn();
vi.mock("@/lib/labs/pta/meetings", () => ({
  setPtaMeetingRsvp: (...args: unknown[]) => setPtaMeetingRsvp(...args),
}));

const findManyEvent = vi.fn();
const findManyMeeting = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: (...args: unknown[]) => findManyEvent(...args) },
    meeting: { findMany: (...args: unknown[]) => findManyMeeting(...args) },
  },
}));

const listAnnouncementsForMember = vi.fn();
vi.mock("@/lib/mobile-announcements", () => ({
  listAnnouncementsForMember: (...args: unknown[]) => listAnnouncementsForMember(...args),
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET as duesGET } from "@/app/api/mobile/pta/dues/route";
import { POST as reportPaymentPOST } from "@/app/api/mobile/pta/dues/report-payment/route";
import { GET as eventsGET } from "@/app/api/mobile/pta/events/route";
import { POST as rsvpPOST } from "@/app/api/mobile/pta/events/[eventId]/rsvp/route";
import { GET as meetingsGET } from "@/app/api/mobile/pta/meetings/route";
import { POST as meetingRsvpPOST } from "@/app/api/mobile/pta/meetings/[id]/rsvp/route";
import { GET as announcementsGET } from "@/app/api/mobile/pta/announcements/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(() => {
  requireMobilePtaHouseholdAccess.mockReset();
  requireMobileOrgAccess.mockReset();
  getPtaParentDuesSummary.mockReset();
  reportPtaDuesPayment.mockReset();
  setPtaEventRsvp.mockReset();
  setPtaMeetingRsvp.mockReset();
  findManyEvent.mockReset();
  findManyMeeting.mockReset();
  listAnnouncementsForMember.mockReset();
});

describe("GET /api/mobile/pta/meetings (Core Meeting RSVP)", () => {
  it("scopes household RSVP to the caller's own household and attaches the normalized block", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    findManyMeeting.mockResolvedValueOnce([
      {
        id: "meeting-1",
        title: "General PTA Meeting",
        meetingType: "General",
        meetingDate: new Date("2026-09-01T18:00:00Z"),
        location: "Library",
        description: null,
        ptaMeetingRsvps: [{ status: "GOING", attendeeCount: 3 }],
      },
    ]);

    const response = await meetingsGET(new Request("https://portal.test/api/mobile/pta/meetings?organizationId=org-a"));
    const body = await response.json();

    expect(findManyMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ ptaMeetingRsvps: { where: { householdId: "household-1" }, select: { status: true, attendeeCount: true } } }),
      })
    );
    expect(body.data[0].rsvp).toEqual({
      mode: "household",
      canRsvp: true,
      guestCounts: true,
      response: { status: "GOING", attendeeCount: 3 },
      subject: { type: "household", id: "household-1" },
    });
  });
});

describe("POST /api/mobile/pta/meetings/[id]/rsvp", () => {
  it("sets RSVP for the caller's own household, never a client-supplied householdId", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    setPtaMeetingRsvp.mockResolvedValueOnce({ id: "rsvp-1", status: "GOING", attendeeCount: 2 });

    const response = await meetingRsvpPOST(
      jsonRequest("https://portal.test/api/mobile/pta/meetings/meeting-1/rsvp", { organizationId: "org-a", status: "GOING", attendeeCount: 2, householdId: "household-forged" }),
      { params: Promise.resolve({ id: "meeting-1" }) }
    );

    expect(response.status).toBe(200);
    expect(setPtaMeetingRsvp).toHaveBeenCalledWith("org-a", "meeting-1", "household-1", { status: "GOING", attendeeCount: 2 }, "user-1", "parent@example.com");
  });
});

describe("GET /api/mobile/pta/dues", () => {
  it("resolves the caller's own household — never a client-supplied householdId — and reuses the web's exact summary shape", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    getPtaParentDuesSummary.mockResolvedValueOnce({ hasBillingIdentity: true, currentCharge: null, priorCharges: [] });

    const response = await duesGET(new Request("https://portal.test/api/mobile/pta/dues?organizationId=org-a"));

    expect(response.status).toBe(200);
    expect(getPtaParentDuesSummary).toHaveBeenCalledWith("org-a", "household-1");
  });
});

describe("POST /api/mobile/pta/dues/report-payment", () => {
  it("reports a payment against the caller's own household", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    reportPtaDuesPayment.mockResolvedValueOnce({ id: "report-1", status: "pending" });

    const response = await reportPaymentPOST(
      jsonRequest("https://portal.test/api/mobile/pta/dues/report-payment", {
        organizationId: "org-a",
        amountCents: 2500,
        paymentMethod: "CASH",
        paymentDate: "2026-01-01T00:00:00.000Z",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("pending");
    expect(reportPtaDuesPayment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", householdId: "household-1", actorUserId: "user-1" })
    );
  });
});

describe("GET /api/mobile/pta/events", () => {
  it("scopes RSVP status to the caller's own household only", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    findManyEvent.mockResolvedValueOnce([
      {
        id: "event-1",
        title: "Book Fair",
        description: null,
        location: null,
        startAt: null,
        endAt: null,
        status: "upcoming",
        ptaVolunteerOpportunities: [],
        ptaEventRsvps: [{ status: "GOING", attendeeCount: 2 }],
      },
    ]);

    const response = await eventsGET(new Request("https://portal.test/api/mobile/pta/events?organizationId=org-a"));
    const body = await response.json();

    expect(findManyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-a" },
        select: expect.objectContaining({ ptaEventRsvps: { where: { householdId: "household-1" }, select: { status: true, attendeeCount: true } } }),
      })
    );
    expect(body.data[0].myRsvp).toEqual({ status: "GOING", attendeeCount: 2 });
  });

  it("also carries the normalized rsvp block (Core Event RSVP) without dropping the legacy myRsvp field old builds read", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    findManyEvent.mockResolvedValueOnce([
      {
        id: "event-1",
        title: "Book Fair",
        description: null,
        location: null,
        startAt: null,
        endAt: null,
        status: "upcoming",
        ptaVolunteerOpportunities: [],
        ptaEventRsvps: [{ status: "GOING", attendeeCount: 2 }],
      },
    ]);

    const response = await eventsGET(new Request("https://portal.test/api/mobile/pta/events?organizationId=org-a"));
    const body = await response.json();

    expect(body.data[0].rsvp).toEqual({
      mode: "household",
      canRsvp: true,
      guestCounts: true,
      response: { status: "GOING", attendeeCount: 2 },
      subject: { type: "household", id: "household-1" },
    });
    // Backward compatibility: the deprecated field must not disappear while
    // old app builds still discriminate on it.
    expect(body.data[0].myRsvp).toEqual({ status: "GOING", attendeeCount: 2 });
  });
});

describe("POST /api/mobile/pta/events/[eventId]/rsvp", () => {
  it("sets RSVP for the caller's own household, never a client-supplied householdId", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    setPtaEventRsvp.mockResolvedValueOnce({ id: "rsvp-1", status: "GOING" });

    const response = await rsvpPOST(
      jsonRequest("https://portal.test/api/mobile/pta/events/event-1/rsvp", { organizationId: "org-a", status: "GOING", attendeeCount: 3 }),
      { params: Promise.resolve({ eventId: "event-1" }) }
    );

    expect(response.status).toBe(200);
    expect(setPtaEventRsvp).toHaveBeenCalledWith("org-a", "event-1", "household-1", { status: "GOING", attendeeCount: 3 }, "user-1", "parent@example.com");
  });
});

describe("GET /api/mobile/pta/announcements", () => {
  it("resolves announcements via the household's shared billing member id, reusing the conventional-member query", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: "member-1" },
    });
    listAnnouncementsForMember.mockResolvedValueOnce([]);

    const response = await announcementsGET(new Request("https://portal.test/api/mobile/pta/announcements?organizationId=org-a"));

    expect(response.status).toBe(200);
    expect(listAnnouncementsForMember).toHaveBeenCalledWith("org-a", "member-1");
  });

  it("returns an empty list (not an error) for a household with no billing identity yet", async () => {
    requireMobilePtaHouseholdAccess.mockResolvedValueOnce({
      organizationId: "org-a",
      session: { userId: "user-1", email: "parent@example.com" },
      adult: { id: "adult-1", householdId: "household-1", billingMemberId: null },
    });

    const response = await announcementsGET(new Request("https://portal.test/api/mobile/pta/announcements?organizationId=org-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(listAnnouncementsForMember).not.toHaveBeenCalled();
  });
});
