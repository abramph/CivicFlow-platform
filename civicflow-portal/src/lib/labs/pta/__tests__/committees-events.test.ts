import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstCommittee = vi.fn();
const findFirstAdult = vi.fn();
const upsertCommitteeMember = vi.fn();
const findFirstEvent = vi.fn();
const findFirstHousehold = vi.fn();
const upsertRsvp = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaCommittee: { findFirst: (...a: unknown[]) => findFirstCommittee(...a), update: vi.fn() },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
    ptaCommitteeMember: { upsert: (...a: unknown[]) => upsertCommitteeMember(...a) },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
    ptaHousehold: { findFirst: (...a: unknown[]) => findFirstHousehold(...a) },
    ptaEventRsvp: { upsert: (...a: unknown[]) => upsertRsvp(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("tenant isolation — committees", () => {
  it("addPtaCommitteeMember cannot add to another organization's committee", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    const { addPtaCommitteeMember } = await import("../committees");
    await expect(addPtaCommitteeMember("org-b", "committee-belonging-to-org-a", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_COMMITTEE_NOT_FOUND" });
    expect(upsertCommitteeMember).not.toHaveBeenCalled();
  });

  it("addPtaCommitteeMember cannot add another organization's household adult", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", organizationId: "org-b" });
    findFirstAdult.mockResolvedValueOnce(null);
    const { addPtaCommitteeMember } = await import("../committees");
    await expect(addPtaCommitteeMember("org-b", "committee-1", "adult-belonging-to-org-a", "u1")).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
  });
});

describe("tenant isolation — event RSVPs (fundraiser/event scoping)", () => {
  it("setPtaEventRsvp cannot RSVP to another organization's event", async () => {
    findFirstEvent.mockResolvedValueOnce(null);
    const { setPtaEventRsvp } = await import("../events");
    await expect(setPtaEventRsvp("org-b", "event-belonging-to-org-a", "household-1", { status: "GOING" }, "u1")).rejects.toMatchObject({ code: "PTA_EVENT_NOT_FOUND" });
    expect(upsertRsvp).not.toHaveBeenCalled();
  });

  it("setPtaEventRsvp cannot RSVP using another organization's household", async () => {
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-b" });
    findFirstHousehold.mockResolvedValueOnce(null);
    const { setPtaEventRsvp } = await import("../events");
    await expect(setPtaEventRsvp("org-b", "event-1", "household-belonging-to-org-a", { status: "GOING" }, "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
  });

  it("rejects a non-positive attendee count", async () => {
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a" });
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a" });
    const { setPtaEventRsvp } = await import("../events");
    await expect(setPtaEventRsvp("org-a", "event-1", "household-1", { status: "GOING", attendeeCount: 0 }, "u1")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});
