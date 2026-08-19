import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrowOrganization = vi.fn();
const updateOrganization = vi.fn().mockResolvedValue(undefined);
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const getAdminSeatSummary = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowOrganization(...args),
      update: (...args: unknown[]) => updateOrganization(...args),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/admin-seats", () => ({ getAdminSeatSummary: (...args: unknown[]) => getAdminSeatSummary(...args) }));

const actor = { organizationId: "org-1", actorUserId: "platform-admin-1", actorEmail: "admin@aphtechgroup.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setAdminSeatOverride", () => {
  it("rejects a negative override", async () => {
    const { setAdminSeatOverride, AdminSeatOverrideError } = await import("../admin-seat-override");
    await expect(
      setAdminSeatOverride({ ...actor, newOverride: -1, reason: "test", expiresAt: null })
    ).rejects.toThrow(AdminSeatOverrideError);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("rejects a non-integer override", async () => {
    const { setAdminSeatOverride, AdminSeatOverrideError } = await import("../admin-seat-override");
    await expect(
      setAdminSeatOverride({ ...actor, newOverride: 2.5, reason: "test", expiresAt: null })
    ).rejects.toThrow(AdminSeatOverrideError);
  });

  it("rejects an empty reason", async () => {
    const { setAdminSeatOverride, AdminSeatOverrideError } = await import("../admin-seat-override");
    await expect(
      setAdminSeatOverride({ ...actor, newOverride: 5, reason: "   ", expiresAt: null })
    ).rejects.toThrow(AdminSeatOverrideError);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("grants a fresh override (0 -> N) and audits ADMIN_SEAT_OVERRIDE_GRANTED", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({ adminSeatOverride: 0 });
    const { setAdminSeatOverride } = await import("../admin-seat-override");

    const result = await setAdminSeatOverride({ ...actor, newOverride: 5, reason: "Launch bump", expiresAt: null });

    expect(result).toEqual({ before: 0, after: 5 });
    expect(updateOrganization).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: expect.objectContaining({
        adminSeatOverride: 5,
        adminSeatOverrideReason: "Launch bump",
        adminSeatOverrideExpiresAt: null,
        adminSeatOverrideSetByUserId: "platform-admin-1",
      }),
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "platform-admin-1",
        action: "ADMIN_SEAT_OVERRIDE_GRANTED",
        metadata: expect.objectContaining({ before: 0, after: 5, reason: "Launch bump" }),
      })
    );
  });

  it("changes an existing override (N -> M) and audits ADMIN_SEAT_OVERRIDE_CHANGED, not GRANTED", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({ adminSeatOverride: 5 });
    const { setAdminSeatOverride } = await import("../admin-seat-override");

    const result = await setAdminSeatOverride({ ...actor, newOverride: 8, reason: "More growth", expiresAt: null });

    expect(result).toEqual({ before: 5, after: 8 });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ADMIN_SEAT_OVERRIDE_CHANGED", metadata: expect.objectContaining({ before: 5, after: 8 }) })
    );
  });

  it("records an expiration date when provided", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({ adminSeatOverride: 0 });
    const { setAdminSeatOverride } = await import("../admin-seat-override");
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");

    await setAdminSeatOverride({ ...actor, newOverride: 3, reason: "Temporary", expiresAt });

    expect(updateOrganization).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: expect.objectContaining({ adminSeatOverrideExpiresAt: expiresAt }),
    });
  });

  it("allows setting the override to exactly 0 (equivalent to removal, but via the grant/change path)", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({ adminSeatOverride: 5 });
    const { setAdminSeatOverride } = await import("../admin-seat-override");
    await expect(
      setAdminSeatOverride({ ...actor, newOverride: 0, reason: "Reducing", expiresAt: null })
    ).resolves.toEqual({ before: 5, after: 0 });
  });
});

describe("removeAdminSeatOverride", () => {
  it("rejects an empty reason", async () => {
    const { removeAdminSeatOverride, AdminSeatOverrideError } = await import("../admin-seat-override");
    await expect(removeAdminSeatOverride({ ...actor, reason: "" })).rejects.toThrow(AdminSeatOverrideError);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("rejects removal when there is no active override to remove", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({ adminSeatOverride: 0 });
    const { removeAdminSeatOverride, AdminSeatOverrideError } = await import("../admin-seat-override");
    await expect(removeAdminSeatOverride({ ...actor, reason: "cleanup" })).rejects.toThrow(AdminSeatOverrideError);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("clears the override back to 0 and audits ADMIN_SEAT_OVERRIDE_REMOVED", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({ adminSeatOverride: 5 });
    const { removeAdminSeatOverride } = await import("../admin-seat-override");

    const result = await removeAdminSeatOverride({ ...actor, reason: "No longer needed" });

    expect(result).toEqual({ before: 5 });
    expect(updateOrganization).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        adminSeatOverride: 0,
        adminSeatOverrideReason: null,
        adminSeatOverrideExpiresAt: null,
        adminSeatOverrideSetByUserId: "platform-admin-1",
        adminSeatOverrideSetAt: expect.any(Date),
      },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ADMIN_SEAT_OVERRIDE_REMOVED", metadata: expect.objectContaining({ before: 5, after: 0 }) })
    );
  });
});

describe("getAdminSeatOverrideDetail", () => {
  it("merges the seat summary with who/when the override was set", async () => {
    getAdminSeatSummary.mockResolvedValueOnce({ usedAdminSeats: 3, effectiveAdminSeatLimit: 10 });
    findUniqueOrThrowOrganization.mockResolvedValueOnce({
      adminSeatOverrideSetByUserId: "platform-admin-1",
      adminSeatOverrideSetAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    const { getAdminSeatOverrideDetail } = await import("../admin-seat-override");

    const detail = await getAdminSeatOverrideDetail("org-1");

    expect(detail).toEqual({
      usedAdminSeats: 3,
      effectiveAdminSeatLimit: 10,
      adminSeatOverrideSetByUserId: "platform-admin-1",
      adminSeatOverrideSetAt: new Date("2026-08-01T00:00:00.000Z"),
    });
  });
});
