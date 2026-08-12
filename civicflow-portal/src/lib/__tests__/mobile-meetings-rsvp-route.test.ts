import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
const findFirstMembership = vi.fn();
const findFirstHouseholdAdult = vi.fn();
const findFirstOrgMember = vi.fn();
const findUniqueOrganization = vi.fn();
const findFirstMeeting = vi.fn();
const findManyMeeting = vi.fn();
const upsertMeetingRsvp = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    organizationMembership: { findFirst: (...args: unknown[]) => findFirstMembership(...args) },
    ptaHouseholdAdult: { findFirst: (...args: unknown[]) => findFirstHouseholdAdult(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    meeting: {
      findFirst: (...args: unknown[]) => findFirstMeeting(...args),
      findMany: (...args: unknown[]) => findManyMeeting(...args),
    },
    meetingRsvp: { upsert: (...args: unknown[]) => upsertMeetingRsvp(...args) },
  },
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

import { GET as getMeetings } from "@/app/api/mobile/meetings/route";
import { POST as postRsvp } from "@/app/api/mobile/meetings/[id]/rsvp/route";
import { signAccessToken } from "@/lib/mobile-auth";

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
  findFirstMeeting.mockReset();
  findManyMeeting.mockReset();
  upsertMeetingRsvp.mockReset();
  createAuditEvent.mockReset();
  createAuditEvent.mockResolvedValue(undefined);
  findUniqueUser.mockResolvedValue({ id: "user-1", email: "user@example.com", mobileTokenVersion: 0 });
});

describe("POST /api/mobile/meetings/[id]/rsvp", () => {
  const params = { params: Promise.resolve({ id: "meeting-1" }) };

  it("lets a Community member RSVP and returns the normalized individual block", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-1" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findFirstMeeting.mockResolvedValue({ id: "meeting-1" });
    upsertMeetingRsvp.mockResolvedValue({ id: "rsvp-1", status: "GOING" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/meetings/meeting-1/rsvp", { organizationId: "org-1", status: "GOING" }),
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

  it("lets an ORG_OWNER with a linked OrgMember RSVP as that member (dual identity)", async () => {
    primeIdentity({ staffMembership: true, orgMember: { id: "member-owner" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "UNION" });
    findFirstMeeting.mockResolvedValue({ id: "meeting-1" });
    upsertMeetingRsvp.mockResolvedValue({ id: "rsvp-2", status: "MAYBE" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/meetings/meeting-1/rsvp", { organizationId: "org-u", status: "MAYBE" }),
      params
    );

    expect(response.status).toBe(200);
    expect(upsertMeetingRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meetingId_orgMemberId: { meetingId: "meeting-1", orgMemberId: "member-owner" } } })
    );
  });

  it("rejects a staff-only login with no linked OrgMember", async () => {
    primeIdentity({ staffMembership: true, orgMember: null });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/meetings/meeting-1/rsvp", { organizationId: "org-1", status: "GOING" }),
      params
    );

    expect(response.status).toBe(403);
    expect(upsertMeetingRsvp).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied orgMemberId — the subject is always the server-resolved member", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-real" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findFirstMeeting.mockResolvedValue({ id: "meeting-1" });
    upsertMeetingRsvp.mockResolvedValue({ id: "rsvp-3", status: "GOING" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/meetings/meeting-1/rsvp", { organizationId: "org-1", status: "GOING", orgMemberId: "member-forged" }),
      params
    );

    expect(response.status).toBe(200);
    expect(upsertMeetingRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ where: { meetingId_orgMemberId: { meetingId: "meeting-1", orgMemberId: "member-real" } } })
    );
  });

  it("rejects a PTA caller even with a linked OrgMember — household RSVP stays authoritative", async () => {
    primeIdentity({ staffMembership: true, householdAdult: true, orgMember: { id: "member-linked" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/meetings/meeting-1/rsvp", { organizationId: "org-pta", status: "GOING" }),
      params
    );

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("MEETING_RSVP_NOT_AVAILABLE");
  });

  it("rejects an HOA org (mode none)", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-h" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/meetings/meeting-1/rsvp", { organizationId: "org-hoa", status: "GOING" }),
      params
    );

    expect(response.status).toBe(403);
  });

  it("404s a meeting outside the caller's organization", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-1" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findFirstMeeting.mockResolvedValue(null);

    const response = await postRsvp(
      await authedRequest("https://portal.test/api/mobile/meetings/meeting-1/rsvp", { organizationId: "org-1", status: "GOING" }),
      params
    );

    expect(response.status).toBe(404);
    expect(upsertMeetingRsvp).not.toHaveBeenCalled();
  });
});

describe("GET /api/mobile/meetings — normalized rsvp block", () => {
  const baseMeeting = {
    id: "meeting-1",
    title: "General Meeting",
    meetingType: null,
    meetingDate: new Date("2026-09-01T18:00:00Z"),
    location: null,
    description: null,
  };

  it("attaches the caller's own RSVP for a Community member and scopes the join to their member id", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-1" } });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findManyMeeting.mockResolvedValue([{ ...baseMeeting, meetingRsvps: [{ status: "GOING" }] }]);

    const response = await getMeetings(await authedRequest("https://portal.test/api/mobile/meetings?organizationId=org-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].rsvp).toEqual(
      expect.objectContaining({ mode: "individual", canRsvp: true, response: { status: "GOING", attendeeCount: 1 } })
    );
    expect(findManyMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ meetingRsvps: { where: { orgMemberId: "member-1" }, select: { status: true } } }),
      })
    );
  });

  it("serves a staff-only login with canRsvp false rather than a 403", async () => {
    primeIdentity({ staffMembership: true, orgMember: null });
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "COMMUNITY" });
    findManyMeeting.mockResolvedValue([baseMeeting]);

    const response = await getMeetings(await authedRequest("https://portal.test/api/mobile/meetings?organizationId=org-1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].rsvp).toEqual(expect.objectContaining({ mode: "individual", canRsvp: false, response: null }));
  });

  it("reports mode none for HOA and mode household (canRsvp false) for a PTA org read generically", async () => {
    primeIdentity({ memberRoleMembership: true, orgMember: { id: "member-h" } });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA" });
    findManyMeeting.mockResolvedValue([baseMeeting]);

    let response = await getMeetings(await authedRequest("https://portal.test/api/mobile/meetings?organizationId=org-hoa"));
    expect((await response.json()).data[0].rsvp).toEqual(expect.objectContaining({ mode: "none", canRsvp: false }));

    primeIdentity({ staffMembership: true, orgMember: { id: "member-linked" } });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA" });
    response = await getMeetings(await authedRequest("https://portal.test/api/mobile/meetings?organizationId=org-pta"));
    expect((await response.json()).data[0].rsvp).toEqual(
      expect.objectContaining({ mode: "household", canRsvp: false, guestCounts: true })
    );
  });

  it("rejects a caller with no tie to the organization", async () => {
    primeIdentity({ orgMember: null });

    const response = await getMeetings(await authedRequest("https://portal.test/api/mobile/meetings?organizationId=org-x"));

    expect(response.status).toBe(403);
  });
});
