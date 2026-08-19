import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS, permissionsFor } from "@/lib/rbac";

const findUniqueOrgRolePermissionSet = vi.fn();
const findUniqueOrThrowOrganization = vi.fn();
const organizationMembershipCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgRolePermissionSet: { findUnique: (...args: unknown[]) => findUniqueOrgRolePermissionSet(...args) },
    organization: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowOrganization(...args) },
    organizationMembership: { count: (...args: unknown[]) => organizationMembershipCount(...args) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgRolePermissionSet.mockResolvedValue(null); // no org customizes any role by default
  organizationMembershipCount.mockResolvedValue(0);
});

describe("includedAdminSeatsFor — per-vertical base allowance", () => {
  it("PTA and COMMUNITY both include 10 seats; CHURCH and UNION include 15", async () => {
    const { includedAdminSeatsFor } = await import("../admin-seats");
    expect(includedAdminSeatsFor("PTA")).toBe(10);
    expect(includedAdminSeatsFor("COMMUNITY")).toBe(10);
    expect(includedAdminSeatsFor("CHURCH")).toBe(15);
    expect(includedAdminSeatsFor("UNION")).toBe(15);
  });

  it("HOA folds into COMMUNITY's 10-seat allowance, matching pricing's own HOA->COMMUNITY mapping", async () => {
    const { includedAdminSeatsFor } = await import("../admin-seats");
    expect(includedAdminSeatsFor("HOA")).toBe(10);
  });
});

describe("getUsedAdminSeats — capability-driven counting, not role-name counting", () => {
  it("counts only default seat-consuming roles (excludes READ_ONLY and MEMBER) when no org customization exists", async () => {
    organizationMembershipCount.mockResolvedValueOnce(4);
    const { getUsedAdminSeats } = await import("../admin-seats");

    const used = await getUsedAdminSeats("org-1");

    expect(used).toBe(4);
    const [[callArgs]] = organizationMembershipCount.mock.calls;
    const roleFilter: string[] = callArgs.where.role.in;
    expect(roleFilter).toEqual(
      expect.arrayContaining(["SUPER_ADMIN", "ORG_OWNER", "ORG_ADMIN", "FINANCE", "STAFF"])
    );
    expect(roleFilter).not.toContain("READ_ONLY");
    expect(roleFilter).not.toContain("MEMBER");
    expect(callArgs.where.status).toBe("active");
    expect(callArgs.where.organizationId).toBe("org-1");
  });

  it("excludes a role from the count entirely once an org trims it down to read-only via OrgRolePermissionSet", async () => {
    findUniqueOrgRolePermissionSet.mockImplementation(({ where }: { where: { organizationId_role: { role: string } } }) =>
      where.organizationId_role.role === "STAFF"
        ? Promise.resolve({ permissions: [PERMISSIONS.MEMBERS_READ, PERMISSIONS.EVENTS_READ] })
        : Promise.resolve(null)
    );
    organizationMembershipCount.mockResolvedValueOnce(2);
    const { getUsedAdminSeats } = await import("../admin-seats");

    await getUsedAdminSeats("org-trimmed");

    const [[callArgs]] = organizationMembershipCount.mock.calls;
    expect(callArgs.where.role.in).not.toContain("STAFF");
  });

  it("includes READ_ONLY in the count once an org expands it via OrgRolePermissionSet", async () => {
    findUniqueOrgRolePermissionSet.mockImplementation(({ where }: { where: { organizationId_role: { role: string } } }) =>
      where.organizationId_role.role === "READ_ONLY"
        ? Promise.resolve({ permissions: [...permissionsFor("READ_ONLY"), PERMISSIONS.EVENTS_WRITE] })
        : Promise.resolve(null)
    );
    const { getUsedAdminSeats } = await import("../admin-seats");

    await getUsedAdminSeats("org-expanded");

    const [[callArgs]] = organizationMembershipCount.mock.calls;
    expect(callArgs.where.role.in).toContain("READ_ONLY");
  });
});

describe("getAdminSeatSummary — the consolidated snapshot", () => {
  it("computes effectiveAdminSeatLimit as included + override + purchased, and availableAdminSeats as the remainder", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({
      primaryVertical: "PTA",
      adminSeatOverride: 2,
      purchasedAdminSeats: 0,
    });
    organizationMembershipCount.mockResolvedValueOnce(9);
    const { getAdminSeatSummary } = await import("../admin-seats");

    const summary = await getAdminSeatSummary("org-1");

    expect(summary).toEqual({
      vertical: "PTA",
      includedAdminSeats: 10,
      adminSeatOverride: 2,
      purchasedAdminSeats: 0,
      effectiveAdminSeatLimit: 12,
      usedAdminSeats: 9,
      availableAdminSeats: 3,
      overLimit: false,
    });
  });

  it("marks overLimit true and clamps availableAdminSeats to 0 when usage exceeds the effective limit (e.g. after an override reduction)", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({
      primaryVertical: "CHURCH",
      adminSeatOverride: 0,
      purchasedAdminSeats: 0,
    });
    organizationMembershipCount.mockResolvedValueOnce(17); // was granted at 17 seats, override since removed
    const { getAdminSeatSummary } = await import("../admin-seats");

    const summary = await getAdminSeatSummary("org-1");

    expect(summary.effectiveAdminSeatLimit).toBe(15);
    expect(summary.usedAdminSeats).toBe(17);
    expect(summary.availableAdminSeats).toBe(0);
    expect(summary.overLimit).toBe(true);
  });

  it("resolves an HOA org's summary through the COMMUNITY allowance", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({
      primaryVertical: "HOA",
      adminSeatOverride: 0,
      purchasedAdminSeats: 0,
    });
    organizationMembershipCount.mockResolvedValueOnce(1);
    const { getAdminSeatSummary } = await import("../admin-seats");

    const summary = await getAdminSeatSummary("org-1");

    expect(summary.vertical).toBe("COMMUNITY");
    expect(summary.includedAdminSeats).toBe(10);
  });

  it("factors purchasedAdminSeats into the effective limit even though it is always 0 at launch", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({
      primaryVertical: "UNION",
      adminSeatOverride: 1,
      purchasedAdminSeats: 5,
    });
    organizationMembershipCount.mockResolvedValueOnce(10);
    const { getAdminSeatSummary } = await import("../admin-seats");

    const summary = await getAdminSeatSummary("org-1");

    expect(summary.effectiveAdminSeatLimit).toBe(21); // 15 + 1 + 5
    expect(summary.availableAdminSeats).toBe(11);
  });
});

describe("hasAvailableAdminSeat — boolean convenience wrapper", () => {
  it("is true when availableAdminSeats > 0", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({
      primaryVertical: "COMMUNITY",
      adminSeatOverride: 0,
      purchasedAdminSeats: 0,
    });
    organizationMembershipCount.mockResolvedValueOnce(9);
    const { hasAvailableAdminSeat } = await import("../admin-seats");

    expect(await hasAvailableAdminSeat("org-1")).toBe(true);
  });

  it("is false when the org is exactly at its effective limit", async () => {
    findUniqueOrThrowOrganization.mockResolvedValueOnce({
      primaryVertical: "COMMUNITY",
      adminSeatOverride: 0,
      purchasedAdminSeats: 0,
    });
    organizationMembershipCount.mockResolvedValueOnce(10);
    const { hasAvailableAdminSeat } = await import("../admin-seats");

    expect(await hasAvailableAdminSeat("org-1")).toBe(false);
  });
});
