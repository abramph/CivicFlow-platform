import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrganization = vi.fn();
const findFirstEvent = vi.fn();
const findFirstOrgMember = vi.fn();
const upsertEventRsvp = vi.fn();
const findManyEventRsvp = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    event: { findFirst: (...args: unknown[]) => findFirstEvent(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    eventRsvp: {
      upsert: (...args: unknown[]) => upsertEventRsvp(...args),
      findMany: (...args: unknown[]) => findManyEventRsvp(...args),
    },
  },
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

import {
  EventRsvpError,
  buildHouseholdRsvpBlock,
  buildIndividualRsvpBlock,
  buildNoRsvpBlock,
  getEventRsvpSummary,
  getRsvpMode,
  resolveRsvpCapability,
  setEventRsvp,
} from "@/lib/event-rsvp";

beforeEach(() => {
  findUniqueOrganization.mockReset();
  findFirstEvent.mockReset();
  findFirstOrgMember.mockReset();
  upsertEventRsvp.mockReset();
  findManyEventRsvp.mockReset();
  createAuditEvent.mockReset();
  createAuditEvent.mockResolvedValue(undefined);
});

describe("getRsvpMode / resolveRsvpCapability — the vertical matrix", () => {
  it("maps each vertical to its approved mode: PTA=household, Community=individual, Union=individual, HOA=none", () => {
    expect(getRsvpMode("PTA")).toBe("household");
    expect(getRsvpMode("COMMUNITY")).toBe("individual");
    expect(getRsvpMode("UNION")).toBe("individual");
    expect(getRsvpMode("HOA")).toBe("none");
  });

  it("grants household canRsvp only on an actual household identity — a PTA officer without a household link cannot RSVP", () => {
    expect(resolveRsvpCapability("PTA", { hasHouseholdIdentity: true, hasMemberIdentity: false })).toEqual({
      mode: "household",
      guestCounts: true,
      canRsvp: true,
    });
    // Officer/staff row: pta.isOfficer=true but no householdAdultId, possibly
    // with a linked OrgMember — the member identity must NOT unlock household
    // RSVP (household identity is authoritative for PTA).
    expect(resolveRsvpCapability("PTA", { hasHouseholdIdentity: false, hasMemberIdentity: true })).toEqual({
      mode: "household",
      guestCounts: true,
      canRsvp: false,
    });
  });

  it("grants individual canRsvp on a linked OrgMember regardless of role, and denies staff-only", () => {
    expect(resolveRsvpCapability("COMMUNITY", { hasHouseholdIdentity: false, hasMemberIdentity: true })).toEqual({
      mode: "individual",
      guestCounts: false,
      canRsvp: true,
    });
    expect(resolveRsvpCapability("UNION", { hasHouseholdIdentity: false, hasMemberIdentity: true })).toEqual({
      mode: "individual",
      guestCounts: false,
      canRsvp: true,
    });
    // Staff-only (owner/admin with no constituent identity).
    expect(resolveRsvpCapability("COMMUNITY", { hasHouseholdIdentity: false, hasMemberIdentity: false })).toEqual({
      mode: "individual",
      guestCounts: false,
      canRsvp: false,
    });
  });

  it("HOA is mode none with canRsvp false no matter what identities exist", () => {
    expect(resolveRsvpCapability("HOA", { hasHouseholdIdentity: true, hasMemberIdentity: true })).toEqual({
      mode: "none",
      guestCounts: false,
      canRsvp: false,
    });
  });
});

describe("normalized RSVP block builders", () => {
  it("household block carries the household subject and guest counts", () => {
    expect(buildHouseholdRsvpBlock("household-1", { status: "GOING", attendeeCount: 3 })).toEqual({
      mode: "household",
      canRsvp: true,
      guestCounts: true,
      response: { status: "GOING", attendeeCount: 3 },
      subject: { type: "household", id: "household-1" },
    });
  });

  it("individual block pins attendeeCount to 1 and derives canRsvp from member presence", () => {
    expect(buildIndividualRsvpBlock("member-1", { status: "MAYBE" })).toEqual({
      mode: "individual",
      canRsvp: true,
      guestCounts: false,
      response: { status: "MAYBE", attendeeCount: 1 },
      subject: { type: "member", id: "member-1" },
    });
    expect(buildIndividualRsvpBlock(null, null)).toEqual({
      mode: "individual",
      canRsvp: false,
      guestCounts: false,
      response: null,
      subject: { type: "none", id: null },
    });
  });

  it("no-RSVP block supports both the HOA (none) and identity-less household cases", () => {
    expect(buildNoRsvpBlock()).toEqual({
      mode: "none",
      canRsvp: false,
      guestCounts: false,
      response: null,
      subject: { type: "none", id: null },
    });
    expect(buildNoRsvpBlock("household")).toEqual(
      expect.objectContaining({ mode: "household", canRsvp: false, guestCounts: true })
    );
  });
});

describe("setEventRsvp — individual RSVP service", () => {
  const communityOrg = { primaryVertical: "COMMUNITY" };

  it("upserts by (eventId, orgMemberId) and writes an audit event", async () => {
    findUniqueOrganization.mockResolvedValue(communityOrg);
    findFirstEvent.mockResolvedValue({ id: "event-1" });
    findFirstOrgMember.mockResolvedValue({ id: "member-1" });
    upsertEventRsvp.mockResolvedValue({ id: "rsvp-1", status: "GOING" });

    const rsvp = await setEventRsvp("org-1", "event-1", "member-1", { status: "GOING" }, "user-1", "u@example.com");

    expect(rsvp).toEqual({ id: "rsvp-1", status: "GOING" });
    expect(upsertEventRsvp).toHaveBeenCalledWith({
      where: { eventId_orgMemberId: { eventId: "event-1", orgMemberId: "member-1" } },
      create: { organizationId: "org-1", eventId: "event-1", orgMemberId: "member-1", status: "GOING" },
      update: { status: "GOING" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "event_rsvp.set", entityId: "rsvp-1" })
    );
  });

  it("rejects a PTA organization — a linked OrgMember must never redirect a PTA caller onto the generic model", async () => {
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA" });

    await expect(setEventRsvp("org-pta", "event-1", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "EVENT_RSVP_NOT_AVAILABLE",
      status: 403,
    });
    expect(upsertEventRsvp).not.toHaveBeenCalled();
  });

  it("rejects an HOA organization (mode none this phase)", async () => {
    findUniqueOrganization.mockResolvedValue({ primaryVertical: "HOA" });

    await expect(setEventRsvp("org-hoa", "event-1", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "EVENT_RSVP_NOT_AVAILABLE",
    });
  });

  it("rejects an unknown organization", async () => {
    findUniqueOrganization.mockResolvedValue(null);

    await expect(setEventRsvp("org-x", "event-1", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "EVENT_RSVP_ORGANIZATION_NOT_FOUND",
      status: 404,
    });
  });

  it("rejects an event that does not belong to the organization (tenant isolation)", async () => {
    findUniqueOrganization.mockResolvedValue(communityOrg);
    findFirstEvent.mockResolvedValue(null);

    await expect(setEventRsvp("org-1", "event-other-org", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "EVENT_RSVP_EVENT_NOT_FOUND",
      status: 404,
    });
    expect(findFirstEvent).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "event-other-org", organizationId: "org-1" } })
    );
    expect(upsertEventRsvp).not.toHaveBeenCalled();
  });

  it("rejects a member that does not belong to the organization (forged/foreign member id)", async () => {
    findUniqueOrganization.mockResolvedValue(communityOrg);
    findFirstEvent.mockResolvedValue({ id: "event-1" });
    findFirstOrgMember.mockResolvedValue(null);

    await expect(setEventRsvp("org-1", "event-1", "member-foreign", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "EVENT_RSVP_MEMBER_NOT_FOUND",
      status: 404,
    });
    expect(findFirstOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "member-foreign", organizationId: "org-1" } })
    );
    expect(upsertEventRsvp).not.toHaveBeenCalled();
  });
});

describe("getEventRsvpSummary — attendees, not rows", () => {
  it("counts one attendee per GOING row and never mixes in maybe/not-going", async () => {
    findFirstEvent.mockResolvedValue({ id: "event-1" });
    findManyEventRsvp.mockResolvedValue([
      { status: "GOING" },
      { status: "GOING" },
      { status: "MAYBE" },
      { status: "NOT_GOING" },
    ]);

    await expect(getEventRsvpSummary("org-1", "event-1")).resolves.toEqual({
      membersGoing: 2,
      membersMaybe: 1,
      membersNotGoing: 1,
      totalAttendees: 2,
    });
  });

  it("refuses to summarize an event outside the organization", async () => {
    findFirstEvent.mockResolvedValue(null);
    await expect(getEventRsvpSummary("org-1", "event-x")).rejects.toBeInstanceOf(EventRsvpError);
  });
});
