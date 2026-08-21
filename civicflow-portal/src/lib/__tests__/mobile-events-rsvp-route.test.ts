import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
const findFirstMembership = vi.fn();
const findFirstHouseholdAdult = vi.fn();
const findFirstOrgMember = vi.fn();
const findUniqueOrganization = vi.fn();
const findFirstEvent = vi.fn();
const findManyEvent = vi.fn();
const upsertEventRsvp = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    organizationMembership: { findFirst: (...args: unknown[]) => findFirstMembership(...args) },
    ptaHouseholdAdult: { findFirst: (...args: unknown[]) => findFirstHouseholdAdult(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    event: {
      findFirst: (...args: unknown[]) => findFirstEvent(...args),
      findMany: (...args: unknown[]) => findManyEvent(...args),
    },
    eventRsvp: { upsert: (...args: unknown[]) => upsertEventRsvp(...args) },
  },
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

// This suite tests RSVP resolution, not the subscription gate — assume
// every organization is allowed.
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: vi.fn().mockResolvedValue({
    allowed: true,
    reason: null,
    trialEndsAt: null,
    subscriptionStatus: null,
    billingExempt: false,
  }),
}));

import { GET as getEvents } from "@/app/api/mobile/events/route";
import { POST as postRsvp } from "@/app/api/mobile/events/[eventId]/rsvp/route";
import { signAccessToken } from "@/lib/mobile-auth";

/** Configure the caller's identity in the org the request names.
 * memberRoleMembership → an active MEMBER-role OrganizationMembership exists;
 * staffMembership → an active staff-role row exists; orgMember → the linked
 * constituent identity requireMobileMembership actually resolves. */
function primeIdentity(options: {
  memberRoleMembership?: boolean;
  staffMembership?: boolean;
  householdAdult?: boolean;
  orgMember?: { id: string } | null;
}) {
  findFirstMembership.mockImplementation((args: { where: { role: unknown } }) => {
    if (args.where.role === "MEMBER") return Promise.resolve(options.memberRoleMembership ? { id: "membership-m" } : null);
    return Promise.resolve(options.staffMembership ? { id: "membership-s", role: "ORG_OWNER" } : null);
  });
  findFirstHouseholdAdult.mockResolvedValue(options.householdAdult ? { id: "adult-1" } : null);
  findFirstOrgMember.mockResolvedValue(options.orgMember ?? null);
}

async function authedRequest(url: string, body?: unknown) {
  const token = await signAccessToken("user-1", 0);
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  findUniqueUser.mockReset();
  findFirstMembership.mockReset();
  findFirstHouseholdAdult.mockReset();
  findFirstOrgMember.mockReset();
  findUniqueOrganization.mockReset();
  findFirstEvent.mockReset();
  findManyEvent.mockReset();
  upsertEventRsvp.mockReset();
  createAuditEvent.mockReset();
  createAuditEvent.mockResolvedValue(undefined);
  findUniqueUser.mockResolvedValue({ id: "user-1", email: "user@example.com", mobileTokenVersion: 0 });
});

describe("POST /api/mobile/events/[eventId]/rsvp", () => {
  const params = { params: Promise.resolve({ eventId: "event-1" }) };

  it("lets a Community member RSVP and returns the normalized individual block", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-1" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findFirstEvent.mockResolvedValue({ id: "event-1" });
    upsertEventRsvp.mockResolvedValue({ id: "rsvp-1", status: "GOING" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-1", status: "GOING" }),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      mode: "individual",
      canRsvp: true,
      guestCounts: false,
      response: { status: "GOING", attendeeCount: 1 },
      subject: { type: "member", id: "member-1" },
    });
  });

  it("lets a Union member RSVP", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-u" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "UNION" });
    findFirstEvent.mockResolvedValue({ id: "event-1" });
    upsertEventRsvp.mockResolvedValue({ id: "rsvp-2", status: "MAYBE" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-u", status: "MAYBE" }),
      params
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.response.status).toBe("MAYBE");
  });

  it("lets an ORG_OWNER with a linked OrgMember RSVP as that member (PR #89 dual identity — role is never required to be MEMBER)", async () => {
    primeIdentity({ staffMembership: true, orgMember: { id: "member-owner" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findFirstEvent.mockResolvedValue({ id: "event-1" });
    upsertEventRsvp.mockResolvedValue({ id: "rsvp-3", status: "GOING" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-1", status: "GOING" }),
      params
    );

    expect(response.status).toBe(200);
    expect(upsertEventRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId_orgMemberId: { eventId: "event-1", orgMemberId: "member-owner" } } })
    );
  });

  it("rejects a staff-only login with no linked OrgMember (403, nothing written)", async () => {
    primeIdentity({ staffMembership: true, orgMember: null });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-1", status: "GOING" }),
      params
    );

    expect(response.status).toBe(403);
    expect(upsertEventRsvp).not.toHaveBeenCalled();
  });

  it("rejects a caller with no tie to the organization at all (cross-tenant)", async () => {
    primeIdentity({ orgMember: { id: "member-1" } }); // an OrgMember alone, with no active membership tie, is not enough

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-foreign", status: "GOING" }),
      params
    );

    expect(response.status).toBe(403);
    expect(upsertEventRsvp).not.toHaveBeenCalled();
  });

  it("ignores any client-supplied orgMemberId — the RSVP subject is always the server-resolved member", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-real" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findFirstEvent.mockResolvedValue({ id: "event-1" });
    upsertEventRsvp.mockResolvedValue({ id: "rsvp-4", status: "GOING" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", {
        organizationId: "org-1",
        status: "GOING",
        orgMemberId: "member-someone-else", // forged — must have no effect
      }),
      params
    );

    expect(response.status).toBe(200);
    expect(upsertEventRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId_orgMemberId: { eventId: "event-1", orgMemberId: "member-real" } } })
    );
  });

  it("rejects a PTA-vertical org even when the caller holds a linked OrgMember — household RSVP stays authoritative for PTA", async () => {
    primeIdentity({ staffMembership: true, householdAdult: true, orgMember: { id: "member-linked" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-pta", status: "GOING" }),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("EVENT_RSVP_NOT_AVAILABLE");
    expect(upsertEventRsvp).not.toHaveBeenCalled();
  });

  it("rejects an HOA org (RSVP mode none this phase)", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-h" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-hoa", status: "GOING" }),
      params
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EVENT_RSVP_NOT_AVAILABLE");
  });

  it("404s an event that is not in the caller's organization", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-1" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findFirstEvent.mockResolvedValue(null);

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/events/event-1/rsvp", { organizationId: "org-1", status: "GOING" }),
      params
    );

    expect(response.status).toBe(404);
    expect(upsertEventRsvp).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/events — normalized rsvp block", () => {
  const baseEvent = {
    id: "event-1",
    title: "Town Hall",
    description: null,
    location: null,
    startAt: null,
    endAt: null,
    status: "upcoming",
  };

  it("attaches the caller's own RSVP for a Community member", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-1" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findManyEvent.mockResolvedValue([{ ...baseEvent, eventRsvps: [{ status: "GOING" }] }]);

    const response = await getEvents(await authedRequest("https://portal.test/api/mobile/events?organizationId=org-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].rsvp).toEqual({
      mode: "individual",
      canRsvp: true,
      guestCounts: false,
      response: { status: "GOING", attendeeCount: 1 },
      subject: { type: "member", id: "member-1" },
    });
    // The member's own RSVP must be scoped to their member id in the query.
    expect(findManyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ eventRsvps: { where: { orgMemberId: "member-1" }, select: { status: true } } }),
      })
    );
  });

  it("serves a staff-only login (no OrgMember) with canRsvp false instead of a 403 — viewing needs only an org tie", async () => {
    primeIdentity({ staffMembership: true, orgMember: null });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findManyEvent.mockResolvedValue([baseEvent]);

    const response = await getEvents(await authedRequest("https://portal.test/api/mobile/events?organizationId=org-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].rsvp).toEqual(
      expect.objectContaining({ mode: "individual", canRsvp: false, response: null, subject: { type: "none", id: null } })
    );
  });

  it("reports mode none for HOA events", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-h" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });
    findManyEvent.mockResolvedValue([baseEvent]);

    const response = await getEvents(await authedRequest("https://portal.test/api/mobile/events?organizationId=org-hoa"));
    const body = await response.json();

    expect(body.data[0].rsvp).toEqual(expect.objectContaining({ mode: "none", canRsvp: false, response: null }));
  });

  it("reports mode household with canRsvp false for a PTA org read through the generic endpoint (staff/member without a household link)", async () => {
    primeIdentity({ staffMembership: true, orgMember: { id: "member-linked" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });
    findManyEvent.mockResolvedValue([baseEvent]);

    const response = await getEvents(await authedRequest("https://portal.test/api/mobile/events?organizationId=org-pta"));
    const body = await response.json();

    expect(body.data[0].rsvp).toEqual(
      expect.objectContaining({ mode: "household", canRsvp: false, guestCounts: true, response: null })
    );
  });

  it("still rejects a caller with no tie to the organization", async () => {
    primeIdentity({ orgMember: null });

    const response = await getEvents(await authedRequest("https://portal.test/api/mobile/events?organizationId=org-x"));

    expect(response.status).toBe(403);
  });
});
