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
const updateOpportunity = vi.fn();
const findManyOpportunity = vi.fn();
const findUniqueProfile = vi.fn();

// claimPtaVolunteerSlot/cancelPtaVolunteerSignup wrap their writes in
// prisma.$transaction(async (tx) => ...) — the mocked $transaction just
// invokes the callback with the same mocked model methods, so existing
// assertions against updateManySlot/upsertSignup/updateSignup keep working
// whether the real code calls them via `prisma.X` or `tx.X`.
const txClient = {
  ptaVolunteerSlot: { updateMany: (...a: unknown[]) => updateManySlot(...a) },
  ptaVolunteerSignup: { upsert: (...a: unknown[]) => upsertSignup(...a), update: (...a: unknown[]) => updateSignup(...a) },
};
const transaction = vi.fn((fn: (tx: typeof txClient) => unknown) => fn(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: Parameters<typeof transaction>) => transaction(...a),
    ptaVolunteerSlot: { findFirst: (...a: unknown[]) => findFirstSlot(...a), updateMany: (...a: unknown[]) => updateManySlot(...a), update: (...a: unknown[]) => updateSlot(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
    ptaVolunteerSignup: {
      findUnique: (...a: unknown[]) => findUniqueSignup(...a),
      upsert: (...a: unknown[]) => upsertSignup(...a),
      findFirst: (...a: unknown[]) => findFirstSignup(...a),
      update: (...a: unknown[]) => updateSignup(...a),
    },
    ptaVolunteerOpportunity: {
      findFirst: (...a: unknown[]) => findFirstOpportunity(...a),
      findMany: (...a: unknown[]) => findManyOpportunity(...a),
      create: (...a: unknown[]) => createOpportunity(...a),
      update: (...a: unknown[]) => updateOpportunity(...a),
    },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

const openSlot = (overrides: Record<string, unknown> = {}) => ({
  id: "slot-1",
  organizationId: "org-a",
  capacity: 2,
  status: "OPEN",
  opportunity: { status: "OPEN", signupDeadline: null },
  ...overrides,
});

describe("claimPtaVolunteerSlot — atomic capacity enforcement", () => {
  it("claims successfully when the conditional UPDATE wins (count === 1)", async () => {
    findFirstSlot.mockResolvedValueOnce(openSlot());
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
    findFirstSlot.mockResolvedValueOnce(openSlot({ capacity: 1 }));
    findFirstAdult.mockResolvedValueOnce({ id: "adult-2", organizationId: "org-a" });
    findUniqueSignup.mockResolvedValueOnce(null);
    updateManySlot.mockResolvedValueOnce({ count: 0 }); // another concurrent claim won first

    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-2", "u1")).rejects.toMatchObject({ code: "PTA_SLOT_FULL" });
    expect(upsertSignup).not.toHaveBeenCalled();
  });

  it("prevents a duplicate active signup by the same adult for the same slot without even attempting the claim", async () => {
    findFirstSlot.mockResolvedValueOnce(openSlot({ capacity: 5 }));
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", organizationId: "org-a" });
    findUniqueSignup.mockResolvedValueOnce({ id: "signup-1", status: "SIGNED_UP" });

    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_SIGNUP_ALREADY_EXISTS" });
    expect(updateManySlot).not.toHaveBeenCalled();
  });

  it("allows re-claiming after a prior cancellation (status CANCELLED does not block a new claim)", async () => {
    findFirstSlot.mockResolvedValueOnce(openSlot({ capacity: 5 }));
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", organizationId: "org-a" });
    findUniqueSignup.mockResolvedValueOnce({ id: "signup-1", status: "CANCELLED" });
    updateManySlot.mockResolvedValueOnce({ count: 1 });
    upsertSignup.mockResolvedValueOnce({ id: "signup-1" });

    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-1", "u1")).resolves.toMatchObject({ id: "signup-1" });
  });

  it("refuses a claim once the opportunity's signup deadline has passed", async () => {
    findFirstSlot.mockResolvedValueOnce(openSlot({ opportunity: { status: "OPEN", signupDeadline: new Date(Date.now() - 60_000) } }));
    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_OPPORTUNITY_SIGNUP_CLOSED" });
    expect(updateManySlot).not.toHaveBeenCalled();
  });

  it("refuses a claim once the opportunity itself is no longer OPEN", async () => {
    findFirstSlot.mockResolvedValueOnce(openSlot({ opportunity: { status: "CLOSED", signupDeadline: null } }));
    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-a", "slot-1", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_OPPORTUNITY_SIGNUP_CLOSED" });
  });
});

describe("tenant isolation — cross-organization volunteer access denied", () => {
  it("claimPtaVolunteerSlot cannot claim another organization's slot", async () => {
    findFirstSlot.mockResolvedValueOnce(null);
    const { claimPtaVolunteerSlot } = await import("../volunteers");
    await expect(claimPtaVolunteerSlot("org-b", "slot-belonging-to-org-a", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_SLOT_NOT_FOUND" });
    expect(findFirstSlot).toHaveBeenCalledWith({ where: { id: "slot-belonging-to-org-a", organizationId: "org-b" }, include: { opportunity: true } });
  });

  it("createPtaVolunteerOpportunity cannot attach to another organization's event", async () => {
    findFirstEvent.mockResolvedValueOnce(null);
    const { createPtaVolunteerOpportunity } = await import("../volunteers");
    await expect(createPtaVolunteerOpportunity({ organizationId: "org-b", title: "Steal event", eventId: "event-belonging-to-org-a", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_EVENT_NOT_FOUND" });
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("updatePtaVolunteerOpportunity cannot attach to another organization's event", async () => {
    findFirstOpportunity.mockResolvedValueOnce({ id: "opp-1", organizationId: "org-b", status: "DRAFT" });
    findFirstEvent.mockResolvedValueOnce(null);
    const { updatePtaVolunteerOpportunity } = await import("../volunteers");
    await expect(
      updatePtaVolunteerOpportunity("org-b", "opp-1", { eventId: "event-belonging-to-org-a" }, "u1")
    ).rejects.toMatchObject({ code: "PTA_EVENT_NOT_FOUND" });
    expect(updateOpportunity).not.toHaveBeenCalled();
  });
});

describe("createPtaVolunteerOpportunity / updatePtaVolunteerOpportunity — event linking", () => {
  it("links a valid same-organization event on create", async () => {
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a" });
    createOpportunity.mockResolvedValueOnce({ id: "opp-1" });
    const { createPtaVolunteerOpportunity } = await import("../volunteers");
    await createPtaVolunteerOpportunity({ organizationId: "org-a", title: "Book Fair setup", eventId: "event-1", actorUserId: "u1" });
    expect(createOpportunity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1" }) }));
  });

  it("links a valid same-organization event on update", async () => {
    findFirstOpportunity.mockResolvedValueOnce({ id: "opp-1", organizationId: "org-a", status: "DRAFT" });
    findFirstEvent.mockResolvedValueOnce({ id: "event-1", organizationId: "org-a" });
    updateOpportunity.mockResolvedValueOnce({ id: "opp-1", eventId: "event-1" });
    const { updatePtaVolunteerOpportunity } = await import("../volunteers");
    await updatePtaVolunteerOpportunity("org-a", "opp-1", { eventId: "event-1" }, "u1");
    expect(updateOpportunity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1" }) }));
  });

  it("unlinks an event on update by passing eventId: null, without re-validating against the event table", async () => {
    findFirstOpportunity.mockResolvedValueOnce({ id: "opp-1", organizationId: "org-a", status: "DRAFT" });
    updateOpportunity.mockResolvedValueOnce({ id: "opp-1", eventId: null });
    const { updatePtaVolunteerOpportunity } = await import("../volunteers");
    await updatePtaVolunteerOpportunity("org-a", "opp-1", { eventId: null }, "u1");
    expect(findFirstEvent).not.toHaveBeenCalled();
    expect(updateOpportunity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventId: null }) }));
  });

  it("listPtaVolunteerOpportunities requests the linked event so the UI can display it", async () => {
    findManyOpportunity.mockResolvedValueOnce([]);
    const { listPtaVolunteerOpportunities } = await import("../volunteers");
    await listPtaVolunteerOpportunities("org-a");
    expect(findManyOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ event: { select: { id: true, title: true, startAt: true } } }) })
    );
  });

  it("getPtaVolunteerOpportunity requests the linked event so the UI can display it", async () => {
    findFirstOpportunity.mockResolvedValueOnce({ id: "opp-1", organizationId: "org-a" });
    const { getPtaVolunteerOpportunity } = await import("../volunteers");
    await getPtaVolunteerOpportunity("org-a", "opp-1");
    expect(findFirstOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ event: { select: { id: true, title: true, startAt: true } } }) })
    );
  });
});

describe("createPtaVolunteerOpportunity — schoolYear regression (an opportunity must not disappear from the officer's own manage-page list)", () => {
  it("falls back to the org's current school year when the caller doesn't supply one, matching what listPtaVolunteerOpportunities' officer-facing filter expects", async () => {
    findUniqueProfile.mockResolvedValueOnce({ organizationId: "org-a", currentSchoolYear: "2025-2026" });
    createOpportunity.mockResolvedValueOnce({ id: "opp-1", schoolYear: "2025-2026" });

    const { createPtaVolunteerOpportunity } = await import("../volunteers");
    await createPtaVolunteerOpportunity({ organizationId: "org-a", title: "Book Fair setup", actorUserId: "u1" });

    expect(findUniqueProfile).toHaveBeenCalledWith({ where: { organizationId: "org-a" } });
    expect(createOpportunity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ schoolYear: "2025-2026" }) }));
  });

  it("respects an explicitly supplied schoolYear rather than overriding it with the org's profile, and skips the profile lookup entirely", async () => {
    createOpportunity.mockResolvedValueOnce({ id: "opp-1", schoolYear: "2024-2025" });

    const { createPtaVolunteerOpportunity } = await import("../volunteers");
    await createPtaVolunteerOpportunity({ organizationId: "org-a", title: "Archive import", schoolYear: "2024-2025", actorUserId: "u1" });

    expect(findUniqueProfile).not.toHaveBeenCalled();
    expect(createOpportunity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ schoolYear: "2024-2025" }) }));
  });

  it("falls back to null (not a crash) when the org has no PtaProfile yet", async () => {
    findUniqueProfile.mockResolvedValueOnce(null);
    createOpportunity.mockResolvedValueOnce({ id: "opp-1", schoolYear: null });

    const { createPtaVolunteerOpportunity } = await import("../volunteers");
    await createPtaVolunteerOpportunity({ organizationId: "org-a", title: "Pre-onboarding opportunity", actorUserId: "u1" });

    expect(createOpportunity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ schoolYear: null }) }));
  });
});

describe("cancelPtaVolunteerSignup — atomic release", () => {
  it("decrements claimedCount only when it is currently above zero, never going negative", async () => {
    findFirstSignup.mockResolvedValueOnce({ id: "signup-1", status: "SIGNED_UP", organizationId: "org-a", slot: { opportunity: { cancellationDeadline: null } } });
    updateSignup.mockResolvedValueOnce({ id: "signup-1", status: "CANCELLED" });

    const { cancelPtaVolunteerSignup } = await import("../volunteers");
    await cancelPtaVolunteerSignup("org-a", "slot-1", "adult-1", "u1");

    expect(updateManySlot).toHaveBeenCalledWith({ where: { id: "slot-1", claimedCount: { gt: 0 } }, data: { claimedCount: { decrement: 1 } } });
  });

  it("is a no-op (not an error) for a signup that's already cancelled", async () => {
    findFirstSignup.mockResolvedValueOnce({ id: "signup-1", status: "CANCELLED", slot: { opportunity: { cancellationDeadline: null } } });
    const { cancelPtaVolunteerSignup } = await import("../volunteers");
    const result = await cancelPtaVolunteerSignup("org-a", "slot-1", "adult-1", "u1");
    expect(result.status).toBe("CANCELLED");
    expect(updateSignup).not.toHaveBeenCalled();
  });

  it("refuses a late cancellation once the opportunity's cancellation deadline has passed, unless an officer override is given", async () => {
    findFirstSignup.mockResolvedValueOnce({ id: "signup-1", status: "SIGNED_UP", slot: { opportunity: { cancellationDeadline: new Date(Date.now() - 60_000) } } });
    const { cancelPtaVolunteerSignup } = await import("../volunteers");
    await expect(cancelPtaVolunteerSignup("org-a", "slot-1", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_CANCELLATION_DEADLINE_PASSED" });
    expect(updateSignup).not.toHaveBeenCalled();
  });

  it("allows a late cancellation when an officer explicitly overrides the deadline", async () => {
    findFirstSignup.mockResolvedValueOnce({ id: "signup-1", status: "SIGNED_UP", slot: { opportunity: { cancellationDeadline: new Date(Date.now() - 60_000) } } });
    updateSignup.mockResolvedValueOnce({ id: "signup-1", status: "CANCELLED" });
    const { cancelPtaVolunteerSignup } = await import("../volunteers");
    await expect(cancelPtaVolunteerSignup("org-a", "slot-1", "adult-1", "officer-1", { officerOverride: true })).resolves.toMatchObject({ status: "CANCELLED" });
  });
});
