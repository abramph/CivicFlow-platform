import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build 27 round-1 expansion — the shared admin RSVP planning aggregation:
 * batched counts for events and meetings plus the admin meeting view. Pins
 * the normative count rules from docs/build27-rsvp-capability-matrix.md:
 * household totalAttendees sums attendeeCount over GOING rows only (guests
 * included, never row counts); individual totalAttendees equals `going`;
 * mode "none" never touches an RSVP table; organizationId WHERE-scopes
 * every query (tenant isolation is structural).
 */

const findUniqueOrganization = vi.fn();
const groupByEventRsvp = vi.fn();
const groupByPtaEventRsvp = vi.fn();
const groupByMeetingRsvp = vi.fn();
const groupByPtaMeetingRsvp = vi.fn();
const findFirstMeeting = vi.fn();
const findManyMeetingRsvp = vi.fn();
const findManyPtaMeetingRsvp = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    eventRsvp: { groupBy: (...a: unknown[]) => groupByEventRsvp(...a) },
    ptaEventRsvp: { groupBy: (...a: unknown[]) => groupByPtaEventRsvp(...a) },
    meetingRsvp: { groupBy: (...a: unknown[]) => groupByMeetingRsvp(...a), findMany: (...a: unknown[]) => findManyMeetingRsvp(...a) },
    ptaMeetingRsvp: { groupBy: (...a: unknown[]) => groupByPtaMeetingRsvp(...a), findMany: (...a: unknown[]) => findManyPtaMeetingRsvp(...a) },
    meeting: { findFirst: (...a: unknown[]) => findFirstMeeting(...a) },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { getAdminEventRsvpCounts } from "@/lib/event-rsvp";
import { getAdminMeetingRsvpCounts, getAdminMeetingRsvpView, MeetingRsvpError } from "@/lib/meeting-rsvp";

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
  groupByEventRsvp.mockResolvedValue([]);
  groupByPtaEventRsvp.mockResolvedValue([]);
  groupByMeetingRsvp.mockResolvedValue([]);
  groupByPtaMeetingRsvp.mockResolvedValue([]);
  findFirstMeeting.mockResolvedValue({ id: "mtg-1" });
  findManyMeetingRsvp.mockResolvedValue([]);
  findManyPtaMeetingRsvp.mockResolvedValue([]);
});

describe("getAdminEventRsvpCounts", () => {
  it("household mode: sums attendeeCount over GOING rows only -- a MAYBE household's guests are never expected attendees", async () => {
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });
    groupByPtaEventRsvp.mockResolvedValue([
      { eventId: "evt-1", status: "GOING", _count: { _all: 3 }, _sum: { attendeeCount: 11 } },
      { eventId: "evt-1", status: "MAYBE", _count: { _all: 2 }, _sum: { attendeeCount: 6 } },
      { eventId: "evt-1", status: "NOT_GOING", _count: { _all: 1 }, _sum: { attendeeCount: 4 } },
      { eventId: "evt-2", status: "GOING", _count: { _all: 1 }, _sum: { attendeeCount: 5 } },
    ]);

    const result = await getAdminEventRsvpCounts("org-a", ["evt-1", "evt-2", "evt-3"]);

    expect(result.mode).toBe("household");
    expect(result.guestCounts).toBe(true);
    expect(result.byId["evt-1"]).toEqual({ totalResponses: 6, going: 3, maybe: 2, notGoing: 1, totalAttendees: 11 });
    expect(result.byId["evt-2"]).toEqual({ totalResponses: 1, going: 1, maybe: 0, notGoing: 0, totalAttendees: 5 });
    // No responses -> no entry (callers render their own zero state).
    expect(result.byId["evt-3"]).toBeUndefined();
    // Tenant isolation is structural: the one grouped query is WHERE-scoped
    // to the organization AND the requested ids.
    expect(groupByPtaEventRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", eventId: { in: ["evt-1", "evt-2", "evt-3"] } } })
    );
    expect(groupByEventRsvp).not.toHaveBeenCalled();
  });

  it("individual mode: totalAttendees equals going -- one GOING member is exactly one attendee", async () => {
    groupByEventRsvp.mockResolvedValue([
      { eventId: "evt-1", status: "GOING", _count: { _all: 4 } },
      { eventId: "evt-1", status: "NOT_GOING", _count: { _all: 2 } },
    ]);

    const result = await getAdminEventRsvpCounts("org-a", ["evt-1"]);

    expect(result.guestCounts).toBe(false);
    expect(result.byId["evt-1"]).toEqual({ totalResponses: 6, going: 4, maybe: 0, notGoing: 2, totalAttendees: 4 });
  });

  it("mode none (HOA): returns an empty result without querying any RSVP table", async () => {
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });

    const result = await getAdminEventRsvpCounts("org-a", ["evt-1"]);

    expect(result).toEqual({ mode: "none", guestCounts: false, byId: {} });
    expect(groupByEventRsvp).not.toHaveBeenCalled();
    expect(groupByPtaEventRsvp).not.toHaveBeenCalled();
  });

  it("empty id list short-circuits before any RSVP query", async () => {
    const result = await getAdminEventRsvpCounts("org-a", []);
    expect(result.byId).toEqual({});
    expect(groupByEventRsvp).not.toHaveBeenCalled();
  });
});

describe("getAdminMeetingRsvpCounts", () => {
  it("household mode groups PtaMeetingRsvp with the same attendee math", async () => {
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });
    groupByPtaMeetingRsvp.mockResolvedValue([
      { meetingId: "mtg-1", status: "GOING", _count: { _all: 2 }, _sum: { attendeeCount: 7 } },
      { meetingId: "mtg-1", status: "MAYBE", _count: { _all: 1 }, _sum: { attendeeCount: 3 } },
    ]);

    const result = await getAdminMeetingRsvpCounts("org-a", ["mtg-1"]);

    expect(result.byId["mtg-1"]).toEqual({ totalResponses: 3, going: 2, maybe: 1, notGoing: 0, totalAttendees: 7 });
    expect(groupByPtaMeetingRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", meetingId: { in: ["mtg-1"] } } })
    );
    expect(groupByMeetingRsvp).not.toHaveBeenCalled();
  });

  it("individual mode groups MeetingRsvp", async () => {
    groupByMeetingRsvp.mockResolvedValue([{ meetingId: "mtg-1", status: "GOING", _count: { _all: 5 } }]);

    const result = await getAdminMeetingRsvpCounts("org-a", ["mtg-1"]);

    expect(result.byId["mtg-1"]).toEqual({ totalResponses: 5, going: 5, maybe: 0, notGoing: 0, totalAttendees: 5 });
  });
});

describe("getAdminMeetingRsvpView", () => {
  it("individual mode: same shape as the admin event view, names + status + respondedAt, no contact fields", async () => {
    findManyMeetingRsvp.mockResolvedValue([
      { id: "r-1", status: "GOING", updatedAt: new Date("2026-09-06T10:00:00Z"), orgMember: { id: "m-1", firstName: "Dana", lastName: "Whitfield" } },
      { id: "r-2", status: "MAYBE", updatedAt: new Date("2026-09-06T11:00:00Z"), orgMember: { id: "m-2", firstName: "Ray", lastName: "Okafor" } },
    ]);

    const view = await getAdminMeetingRsvpView("org-a", "mtg-1");

    expect(view.mode).toBe("individual");
    expect(view.summary).toEqual({ totalResponses: 2, going: 1, maybe: 1, notGoing: 0, totalAttendees: 1 });
    expect(view.responses[0]).toMatchObject({ name: "Dana Whitfield", status: "GOING", attendeeCount: null });
    for (const response of view.responses) {
      expect(Object.keys(response).sort()).toEqual(["attendeeCount", "id", "name", "respondedAt", "status"]);
    }
  });

  it("household mode: reuses the PTA meeting services' rows and guest math", async () => {
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });
    findManyPtaMeetingRsvp.mockResolvedValue([
      { id: "r-1", status: "GOING", attendeeCount: 4, updatedAt: new Date("2026-09-06T10:00:00Z"), household: { id: "hh-1", displayName: "The Alvarez Family" } },
      { id: "r-2", status: "NOT_GOING", attendeeCount: 2, updatedAt: new Date("2026-09-06T11:00:00Z"), household: { id: "hh-2", displayName: "The Kim Family" } },
    ]);

    const view = await getAdminMeetingRsvpView("org-a", "mtg-1");

    expect(view.mode).toBe("household");
    expect(view.guestCounts).toBe(true);
    expect(view.summary).toEqual({ totalResponses: 2, going: 1, maybe: 0, notGoing: 1, totalAttendees: 4 });
    expect(view.responses[0]).toMatchObject({ name: "The Alvarez Family", attendeeCount: 4 });
  });

  it("mode none: empty view, no RSVP query", async () => {
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });

    const view = await getAdminMeetingRsvpView("org-a", "mtg-1");

    expect(view).toEqual({ mode: "none", guestCounts: false, summary: null, responses: [] });
    expect(findManyMeetingRsvp).not.toHaveBeenCalled();
    expect(findManyPtaMeetingRsvp).not.toHaveBeenCalled();
  });

  it("cross-organization meeting: the underlying list service 404s (MeetingRsvpError), never returns another tenant's rows", async () => {
    findFirstMeeting.mockResolvedValue(null);

    await expect(getAdminMeetingRsvpView("org-a", "mtg-other-org")).rejects.toBeInstanceOf(MeetingRsvpError);
    expect(findFirstMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "mtg-other-org", organizationId: "org-a" } })
    );
  });
});
