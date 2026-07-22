import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstSlot = vi.fn();
const updateManySlot = vi.fn();
const updateSlot = vi.fn();
const findFirstAdult = vi.fn();
const findUniqueSignup = vi.fn();
const upsertSignup = vi.fn();
const findFirstSignup = vi.fn();
const updateSignup = vi.fn();
const findFirstOpportunity = vi.fn();
const findFirstEvent = vi.fn();
const createOpportunity = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerSlot: { findFirst: (...a: unknown[]) => findFirstSlot(...a), updateMany: (...a: unknown[]) => updateManySlot(...a), update: (...a: unknown[]) => updateSlot(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
    ptaVolunteerSignup: {
      findUnique: (...a: unknown[]) => findUniqueSignup(...a),
      upsert: (...a: unknown[]) => upsertSignup(...a),
      findFirst: (...a: unknown[]) => findFirstSignup(...a),
      update: (...a: unknown[]) => updateSignup(...a),
    },
    ptaVolunteerOpportunity: { findFirst: (...a: unknown[]) => findFirstOpportunity(...a), create: (...a: unknown[]) => createOpportunity(...a) },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("claimPtaVolunteerSlot — atomic capacity enforcement", () => {
  it("claims successfully when the conditional UPDATE wins (count === 1)", async () => {
    findFirstSlot.mockResolvedValueOnce({ id: "slot-1", organizationId: "org-a", capacity: 2 });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", organizationId: "org-a" });
    findUniqueSignup.mockResolvedValueOnce(null);
    updateManySlot.mockResolvedValueOnce({ count: 1 });
    upsertSignup.mockResolvedValueOnce({ id: "signup-1" });

    const { claimPtaVolunteerSlot } = await import("../volunteers");
    const result = await claimPtaVolunteerSlot("org-a", "slot-1", "adult-1", "u1");
    expect(result.id).toBe("signup-1");
    expect(updateManySlot).toHaveBeenCalledWith({ where: { id: "slot-1", claimedCount: { lt: 2 } }, data: { claimedCount: { increment: 1 } } });
  });

  it("rejects with PTA_SLOT_FULL when the conditional UPDATE loses the race (count === 0) — this is what actually prevents overbooking, not a prior read", async () => {
    findFirstSlot.mockResolvedValueOnce({ id: "slot-1", organizationId: "org-a", capacity: 1 });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-2", organizationId: "org-a" });
    findUniqueSignup.mockResolvedValueOnce(null);
    updateManySlot.mockResolvedValueOnce({ count: 0 }); // another concurrent claim won first

    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-2", "u1")).rejects.toMatchObject({ code: "PTA_SLOT_FULL" });
    expect(upsertSignup).not.toHaveBeenCalled();
  });

  it("prevents a duplicate active signup by the same adult for the same slot without even attempting the claim", async () => {
    findFirstSlot.mockResolvedValueOnce({ id: "slot-1", organizationId: "org-a", capacity: 5 });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", organizationId: "org-a" });
    findUniqueSignup.mockResolvedValueOnce({ id: "signup-1", status: "SIGNED_UP" });

    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_SIGNUP_ALREADY_EXISTS" });
    expect(updateManySlot).not.toHaveBeenCalled();
  });

  it("allows re-claiming after a prior cancellation (status CANCELLED does not block a new claim)", async () => {
    findFirstSlot.mockResolvedValueOnce({ id: "slot-1", organizationId: "org-a", capacity: 5 });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", organizationId: "org-a" });
    findUniqueSignup.mockResolvedValueOnce({ id: "signup-1", status: "CANCELLED" });
    updateManySlot.mockResolvedValueOnce({ count: 1 });
    upsertSignup.mockResolvedValueOnce({ id: "signup-1" });

    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-1", "u1")).resolves.toMatchObject({ id: "signup-1" });
  });
});

describe("tenant isolation — cross-organization volunteer access denied", () => {
  it("claimPtaVolunteerSlot cannot claim another organization's slot", async () => {
    findFirstSlot.mockResolvedValueOnce(null);
    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-b", "slot-belonging-to-org-a", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_SLOT_NOT_FOUND" });
    expect(findFirstSlot).toHaveBeenCalledWith({ where: { id: "slot-belonging-to-org-a", organizationId: "org-b" } });
  });

  it("createPtaVolunteerOpportunity cannot attach to another organization's event", async () => {
    findFirstEvent.mockResolvedValueOnce(null);
    const { createPtaVolunteerOpportunity } = await import("../volunteers");
    await expect(createPtaVolunteerOpportunity({ organizationId: "org-b", title: "Steal event", eventId: "event-belonging-to-org-a", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_EVENT_NOT_FOUND" });
    expect(createOpportunity).not.toHaveBeenCalled();
  });
});

describe("cancelPtaVolunteerSignup — atomic release", () => {
  it("decrements claimedCount only when it is currently above zero, never going negative", async () => {
    findFirstSignup.mockResolvedValueOnce({ id: "signup-1", status: "SIGNED_UP", organizationId: "org-a" });
    updateSignup.mockResolvedValueOnce({ id: "signup-1", status: "CANCELLED" });

    const { cancelPtaVolunteerSignup } = await import("../volunteers");
    await cancelPtaVolunteerSignup("org-a", "slot-1", "adult-1", "u1");

    expect(updateManySlot).toHaveBeenCalledWith({ where: { id: "slot-1", claimedCount: { gt: 0 } }, data: { claimedCount: { decrement: 1 } } });
  });

  it("is a no-op (not an error) for a signup that's already cancelled", async () => {
    findFirstSignup.mockResolvedValueOnce({ id: "signup-1", status: "CANCELLED" });
    const { cancelPtaVolunteerSignup } = await import("../volunteers");
    const result = await cancelPtaVolunteerSignup("org-a", "slot-1", "adult-1", "u1");
    expect(result.status).toBe("CANCELLED");
    expect(updateSignup).not.toHaveBeenCalled();
  });
});
