import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrganization = vi.fn();
const findFirstMeeting = vi.fn();
const findFirstOrgMember = vi.fn();
const upsertMeetingRsvp = vi.fn();
const findManyMeetingRsvp = vi.fn();
const findFirstPtaHousehold = vi.fn();
const upsertPtaMeetingRsvp = vi.fn();
const findManyPtaMeetingRsvp = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    meeting: { findFirst: (...args: unknown[]) => findFirstMeeting(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    ptaHousehold: { findFirst: (...args: unknown[]) => findFirstPtaHousehold(...args) },
    meetingRsvp: {
      upsert: (...args: unknown[]) => upsertMeetingRsvp(...args),
      findMany: (...args: unknown[]) => findManyMeetingRsvp(...args),
    },
    ptaMeetingRsvp: {
      upsert: (...args: unknown[]) => upsertPtaMeetingRsvp(...args),
      findMany: (...args: unknown[]) => findManyPtaMeetingRsvp(...args),
    },
  },
}));

const createAuditEvent = vi.fn();
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEvent(...args),
}));

import { MeetingRsvpError, getMeetingRsvpSummary, setMeetingRsvp } from "@/lib/meeting-rsvp";
import { getPtaMeetingAttendanceSummary, setPtaMeetingRsvp } from "@/lib/labs/pta/meetings";

beforeEach(() => {
  findUniqueOrganization.mockReset();
  findFirstMeeting.mockReset();
  findFirstOrgMember.mockReset();
  upsertMeetingRsvp.mockReset();
  findManyMeetingRsvp.mockReset();
  findFirstPtaHousehold.mockReset();
  upsertPtaMeetingRsvp.mockReset();
  findManyPtaMeetingRsvp.mockReset();
  createAuditEvent.mockReset();
  createAuditEvent.mockResolvedValue(undefined);
});

describe("setMeetingRsvp — individual meeting RSVP service", () => {
  const communityOrg = { primaryVertical: "COMMUNITY" };

  it("upserts by (meetingId, orgMemberId) and writes an audit event", async () => {
    findUniqueOrganization.mockResolvedValue(communityOrg);
    findFirstMeeting.mockResolvedValue({ id: "meeting-1" });
    findFirstOrgMember.mockResolvedValue({ id: "member-1" });
    upsertMeetingRsvp.mockResolvedValue({ id: "rsvp-1", status: "GOING" });

    const rsvp = await setMeetingRsvp("org-1", "meeting-1", "member-1", { status: "GOING" }, "user-1", "u@example.com");

    expect(rsvp).toEqual({ id: "rsvp-1", status: "GOING" });
    expect(upsertMeetingRsvp).toHaveBeenCalledWith({
      where: { meetingId_orgMemberId: { meetingId: "meeting-1", orgMemberId: "member-1" } },
      create: { organizationId: "org-1", meetingId: "meeting-1", orgMemberId: "member-1", status: "GOING" },
      update: { status: "GOING" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "meeting_rsvp.set", entityId: "rsvp-1" })
    );
  });

  it("rejects PTA (household is authoritative) and HOA (mode none) organizations", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "PTA" });
    await expect(setMeetingRsvp("org-pta", "m-1", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "MEETING_RSVP_NOT_AVAILABLE",
      status: 403,
    });

    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "HOA" });
    await expect(setMeetingRsvp("org-hoa", "m-1", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "MEETING_RSVP_NOT_AVAILABLE",
    });
    expect(upsertMeetingRsvp).not.toHaveBeenCalled();
  });

  it("enforces tenant integrity on organization, meeting, and member", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);
    await expect(setMeetingRsvp("org-x", "m-1", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "MEETING_RSVP_ORGANIZATION_NOT_FOUND",
    });

    findUniqueOrganization.mockResolvedValue(communityOrg);
    findFirstMeeting.mockResolvedValueOnce(null);
    await expect(setMeetingRsvp("org-1", "m-foreign", "member-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "MEETING_RSVP_MEETING_NOT_FOUND",
      status: 404,
    });
    expect(findFirstMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m-foreign", organizationId: "org-1" } })
    );

    findFirstMeeting.mockResolvedValue({ id: "m-1" });
    findFirstOrgMember.mockResolvedValueOnce(null);
    await expect(setMeetingRsvp("org-1", "m-1", "member-foreign", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "MEETING_RSVP_MEMBER_NOT_FOUND",
    });
    expect(upsertMeetingRsvp).not.toHaveBeenCalled();
  });
});

describe("getMeetingRsvpSummary — attendees, not rows", () => {
  it("counts one attendee per GOING row", async () => {
    findFirstMeeting.mockResolvedValue({ id: "m-1" });
    findManyMeetingRsvp.mockResolvedValue([{ status: "GOING" }, { status: "GOING" }, { status: "MAYBE" }, { status: "NOT_GOING" }]);

    await expect(getMeetingRsvpSummary("org-1", "m-1")).resolves.toEqual({
      membersGoing: 2,
      membersMaybe: 1,
      membersNotGoing: 1,
      totalAttendees: 2,
    });
  });

  it("refuses a meeting outside the organization", async () => {
    findFirstMeeting.mockResolvedValue(null);
    await expect(getMeetingRsvpSummary("org-1", "m-x")).rejects.toBeInstanceOf(MeetingRsvpError);
  });
});

describe("setPtaMeetingRsvp — household meeting RSVP service", () => {
  it("upserts by (meetingId, householdId) with the household's attendee count", async () => {
    findFirstMeeting.mockResolvedValue({ id: "m-1" });
    findFirstPtaHousehold.mockResolvedValue({ id: "household-1" });
    upsertPtaMeetingRsvp.mockResolvedValue({ id: "rsvp-1", status: "GOING", attendeeCount: 4 });

    const rsvp = await setPtaMeetingRsvp("org-pta", "m-1", "household-1", { status: "GOING", attendeeCount: 4 }, "user-1");

    expect(rsvp.attendeeCount).toBe(4);
    expect(upsertPtaMeetingRsvp).toHaveBeenCalledWith({
      where: { meetingId_householdId: { meetingId: "m-1", householdId: "household-1" } },
      create: { organizationId: "org-pta", meetingId: "m-1", householdId: "household-1", status: "GOING", attendeeCount: 4 },
      update: { status: "GOING", attendeeCount: 4 },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.meeting_rsvp.set" }));
  });

  it("NOT_GOING records 0 attendees regardless of the submitted count; GOING requires >= 1", async () => {
    findFirstMeeting.mockResolvedValue({ id: "m-1" });
    findFirstPtaHousehold.mockResolvedValue({ id: "household-1" });
    upsertPtaMeetingRsvp.mockResolvedValue({ id: "rsvp-1", status: "NOT_GOING", attendeeCount: 0 });

    await setPtaMeetingRsvp("org-pta", "m-1", "household-1", { status: "NOT_GOING", attendeeCount: 4 }, "user-1");
    expect(upsertPtaMeetingRsvp).toHaveBeenCalledWith(
      expect.objectContaining({ update: { status: "NOT_GOING", attendeeCount: 0 } })
    );

    await expect(setPtaMeetingRsvp("org-pta", "m-1", "household-1", { status: "GOING", attendeeCount: 0 }, "user-1")).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("rejects a meeting or household outside the organization, and invalid attendee counts", async () => {
    findFirstMeeting.mockResolvedValueOnce(null);
    await expect(setPtaMeetingRsvp("org-pta", "m-x", "household-1", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "PTA_MEETING_NOT_FOUND",
      status: 404,
    });

    findFirstMeeting.mockResolvedValue({ id: "m-1" });
    findFirstPtaHousehold.mockResolvedValueOnce(null);
    await expect(setPtaMeetingRsvp("org-pta", "m-1", "household-x", { status: "GOING" }, "user-1")).rejects.toMatchObject({
      code: "PTA_HOUSEHOLD_NOT_FOUND",
    });

    findFirstPtaHousehold.mockResolvedValue({ id: "household-1" });
    await expect(setPtaMeetingRsvp("org-pta", "m-1", "household-1", { status: "GOING", attendeeCount: 0 }, "user-1")).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
    expect(upsertPtaMeetingRsvp).not.toHaveBeenCalled();
  });
});

describe("getPtaMeetingAttendanceSummary — sums household attendee counts", () => {
  it("aggregates attendees from GOING households only", async () => {
    findFirstMeeting.mockResolvedValue({ id: "m-1" });
    findManyPtaMeetingRsvp.mockResolvedValue([
      { status: "GOING", attendeeCount: 3 },
      { status: "GOING", attendeeCount: 2 },
      { status: "MAYBE", attendeeCount: 5 },
      { status: "NOT_GOING", attendeeCount: 1 },
    ]);

    await expect(getPtaMeetingAttendanceSummary("org-pta", "m-1")).resolves.toEqual({
      householdsGoing: 2,
      totalAttendees: 5,
      householdsMaybe: 1,
      householdsNotGoing: 1,
    });
  });
});
