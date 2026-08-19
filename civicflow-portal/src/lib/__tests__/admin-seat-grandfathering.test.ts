import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOrganization = vi.fn();
const updateOrganization = vi.fn();
const getAdminSeatSummary = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/admin-seats", () => ({
  getAdminSeatSummary: (...args: unknown[]) => getAdminSeatSummary(...args),
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const db = {
  organization: {
    findMany: (...args: unknown[]) => findManyOrganization(...args),
    update: (...args: unknown[]) => updateOrganization(...args),
  },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runAdminSeatGrandfathering", () => {
  it("grants nothing and writes nothing for an org already within its effective limit", async () => {
    findManyOrganization.mockResolvedValueOnce([
      { id: "org-1", name: "Pine Grove PTA", adminSeatOverride: 0, purchasedAdminSeats: 0 },
    ]);
    getAdminSeatSummary.mockResolvedValueOnce({
      vertical: "PTA",
      includedAdminSeats: 10,
      adminSeatOverride: 0,
      purchasedAdminSeats: 0,
      effectiveAdminSeatLimit: 10,
      usedAdminSeats: 4,
      availableAdminSeats: 6,
      overLimit: false,
    });

    const { runAdminSeatGrandfathering } = await import("../admin-seat-grandfathering");
    const result = await runAdminSeatGrandfathering(db, { dryRun: false });

    expect(result.actions).toEqual([]);
    expect(result.organizationsScanned).toBe(1);
    expect(updateOrganization).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("grants exactly enough override to cover an org already over its new limit", async () => {
    findManyOrganization.mockResolvedValueOnce([
      { id: "org-2", name: "Legacy Big Union Local", adminSeatOverride: 0, purchasedAdminSeats: 0 },
    ]);
    getAdminSeatSummary.mockResolvedValueOnce({
      vertical: "UNION",
      includedAdminSeats: 15,
      adminSeatOverride: 0,
      purchasedAdminSeats: 0,
      effectiveAdminSeatLimit: 15,
      usedAdminSeats: 18, // over the new 15-seat allowance
      availableAdminSeats: 0,
      overLimit: true,
    });

    const { runAdminSeatGrandfathering } = await import("../admin-seat-grandfathering");
    const result = await runAdminSeatGrandfathering(db, { dryRun: false });

    expect(result.actions).toEqual([
      {
        organizationId: "org-2",
        organizationName: "Legacy Big Union Local",
        usedAdminSeats: 18,
        effectiveLimitBefore: 15,
        overrideBefore: 0,
        overrideAfter: 3, // 18 used - 15 included - 0 purchased
      },
    ]);
    expect(updateOrganization).toHaveBeenCalledWith({
      where: { id: "org-2" },
      data: expect.objectContaining({
        adminSeatOverride: 3,
        adminSeatOverrideReason: "Automatic launch grandfathering — existing administrative access preserved",
        adminSeatOverrideSetByUserId: null,
      }),
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-2", action: "ADMIN_SEAT_OVERRIDE_GRANTED" })
    );
  });

  it("never reduces an existing override, and skips writing when the existing override already covers usage", async () => {
    findManyOrganization.mockResolvedValueOnce([
      { id: "org-3", name: "Already Overridden Org", adminSeatOverride: 10, purchasedAdminSeats: 0 },
    ]);
    getAdminSeatSummary.mockResolvedValueOnce({
      vertical: "COMMUNITY",
      includedAdminSeats: 10,
      adminSeatOverride: 10,
      purchasedAdminSeats: 0,
      effectiveAdminSeatLimit: 20,
      usedAdminSeats: 12, // well within the existing override-inflated limit
      availableAdminSeats: 8,
      overLimit: false,
    });

    const { runAdminSeatGrandfathering } = await import("../admin-seat-grandfathering");
    const result = await runAdminSeatGrandfathering(db, { dryRun: false });

    expect(result.actions).toEqual([]);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("dry-run computes the same actions but writes nothing", async () => {
    findManyOrganization.mockResolvedValueOnce([
      { id: "org-4", name: "Church Over Limit", adminSeatOverride: 0, purchasedAdminSeats: 0 },
    ]);
    getAdminSeatSummary.mockResolvedValueOnce({
      vertical: "CHURCH",
      includedAdminSeats: 15,
      adminSeatOverride: 0,
      purchasedAdminSeats: 0,
      effectiveAdminSeatLimit: 15,
      usedAdminSeats: 17,
      availableAdminSeats: 0,
      overLimit: true,
    });

    const { runAdminSeatGrandfathering } = await import("../admin-seat-grandfathering");
    const result = await runAdminSeatGrandfathering(db, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].overrideAfter).toBe(2);
    expect(updateOrganization).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("scans every organization independently and only reports the ones that actually need a grant", async () => {
    findManyOrganization.mockResolvedValueOnce([
      { id: "org-a", name: "Fine", adminSeatOverride: 0, purchasedAdminSeats: 0 },
      { id: "org-b", name: "Over", adminSeatOverride: 0, purchasedAdminSeats: 0 },
      { id: "org-c", name: "Also Fine", adminSeatOverride: 0, purchasedAdminSeats: 0 },
    ]);
    getAdminSeatSummary
      .mockResolvedValueOnce({ includedAdminSeats: 10, adminSeatOverride: 0, purchasedAdminSeats: 0, effectiveAdminSeatLimit: 10, usedAdminSeats: 2, overLimit: false })
      .mockResolvedValueOnce({ includedAdminSeats: 10, adminSeatOverride: 0, purchasedAdminSeats: 0, effectiveAdminSeatLimit: 10, usedAdminSeats: 11, overLimit: true })
      .mockResolvedValueOnce({ includedAdminSeats: 10, adminSeatOverride: 0, purchasedAdminSeats: 0, effectiveAdminSeatLimit: 10, usedAdminSeats: 9, overLimit: false });

    const { runAdminSeatGrandfathering } = await import("../admin-seat-grandfathering");
    const result = await runAdminSeatGrandfathering(db, { dryRun: true });

    expect(result.organizationsScanned).toBe(3);
    expect(result.actions.map((a) => a.organizationId)).toEqual(["org-b"]);
  });
});
