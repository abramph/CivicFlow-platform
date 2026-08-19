import { describe, expect, it, vi, beforeEach } from "vitest";
import { PERMISSIONS, permissionsFor } from "@/lib/rbac";
import { requiresAdministrativeSeat } from "../admin-seat-policy";

const findUniqueOrgRolePermissionSet = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgRolePermissionSet: { findUnique: (...args: unknown[]) => findUniqueOrgRolePermissionSet(...args) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgRolePermissionSet.mockResolvedValue(null);
});

describe("requiresAdministrativeSeat — pure classification function", () => {
  it("is false for an empty permission set (MEMBER)", () => {
    expect(requiresAdministrativeSeat([])).toBe(false);
  });

  it("is false for READ_ONLY's exact default bundle", () => {
    expect(requiresAdministrativeSeat(permissionsFor("READ_ONLY"))).toBe(false);
  });

  it("is false for any subset of READ_ONLY's bundle", () => {
    expect(requiresAdministrativeSeat([PERMISSIONS.MEMBERS_READ, PERMISSIONS.DUES_READ])).toBe(false);
  });

  it("is true the moment a single non-read-only permission is present, even alongside many read ones", () => {
    const mostlyReadOnly = [...permissionsFor("READ_ONLY"), PERMISSIONS.MEMBERS_WRITE];
    expect(requiresAdministrativeSeat(mostlyReadOnly)).toBe(true);
  });

  it("is true for a single write/manage/approve/resolve/close/terminate/export permission in isolation", () => {
    const spotChecks = [
      PERMISSIONS.MEMBERS_TERMINATE,
      PERMISSIONS.BILLING_MANAGE,
      PERMISSIONS.HOA_VIOLATIONS_RESOLVE,
      PERMISSIONS.UNION_CASES_CLOSE,
      PERMISSIONS.MEMBER_INTAKE_EXPORT,
      PERMISSIONS.PTA_MINUTES_APPROVE,
      PERMISSIONS.CONTRIBUTIONS_INDIVIDUAL_VIEW,
    ];
    for (const permission of spotChecks) {
      expect(requiresAdministrativeSeat([permission])).toBe(true);
    }
  });

  it("classifies every default role bundle exactly as expected", () => {
    expect(requiresAdministrativeSeat(permissionsFor("MEMBER"))).toBe(false);
    expect(requiresAdministrativeSeat(permissionsFor("READ_ONLY"))).toBe(false);
    expect(requiresAdministrativeSeat(permissionsFor("STAFF"))).toBe(true);
    expect(requiresAdministrativeSeat(permissionsFor("FINANCE"))).toBe(true);
    expect(requiresAdministrativeSeat(permissionsFor("ORG_ADMIN"))).toBe(true);
    expect(requiresAdministrativeSeat(permissionsFor("ORG_OWNER"))).toBe(true);
    expect(requiresAdministrativeSeat(permissionsFor("SUPER_ADMIN"))).toBe(true);
  });
});

describe("roleRequiresAdministrativeSeat — org-aware, honors OrgRolePermissionSet overrides", () => {
  it("MEMBER never queries the database and is always false", async () => {
    const { roleRequiresAdministrativeSeat } = await import("../admin-seat-policy");
    expect(await roleRequiresAdministrativeSeat("org-1", "MEMBER")).toBe(false);
    expect(findUniqueOrgRolePermissionSet).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN and ORG_OWNER always consume a seat, ignoring any override lookup (hard safety rail)", async () => {
    const { roleRequiresAdministrativeSeat } = await import("../admin-seat-policy");
    expect(await roleRequiresAdministrativeSeat("org-1", "ORG_OWNER")).toBe(true);
    expect(await roleRequiresAdministrativeSeat("org-1", "SUPER_ADMIN")).toBe(true);
  });

  it("a default (unmodified) STAFF/FINANCE/ORG_ADMIN role consumes a seat", async () => {
    const { roleRequiresAdministrativeSeat } = await import("../admin-seat-policy");
    expect(await roleRequiresAdministrativeSeat("org-1", "STAFF")).toBe(true);
    expect(await roleRequiresAdministrativeSeat("org-1", "FINANCE")).toBe(true);
    expect(await roleRequiresAdministrativeSeat("org-1", "ORG_ADMIN")).toBe(true);
  });

  it("a default (unmodified) READ_ONLY role never consumes a seat", async () => {
    const { roleRequiresAdministrativeSeat } = await import("../admin-seat-policy");
    expect(await roleRequiresAdministrativeSeat("org-1", "READ_ONLY")).toBe(false);
  });

  it("classifies by EFFECTIVE permissions, not role label: an org that trims STAFF down to read-only via OrgRolePermissionSet no longer consumes a seat", async () => {
    findUniqueOrgRolePermissionSet.mockResolvedValue({
      permissions: [PERMISSIONS.MEMBERS_READ, PERMISSIONS.EVENTS_READ],
    });
    const { roleRequiresAdministrativeSeat } = await import("../admin-seat-policy");
    expect(await roleRequiresAdministrativeSeat("org-1", "STAFF")).toBe(false);
  });

  it("classifies by EFFECTIVE permissions the other direction too: an org that expands READ_ONLY via OrgRolePermissionSet now consumes a seat", async () => {
    findUniqueOrgRolePermissionSet.mockResolvedValue({
      permissions: [...permissionsFor("READ_ONLY"), PERMISSIONS.EVENTS_WRITE],
    });
    const { roleRequiresAdministrativeSeat } = await import("../admin-seat-policy");
    expect(await roleRequiresAdministrativeSeat("org-1", "READ_ONLY")).toBe(true);
  });

  it("an OrgRolePermissionSet override for one org never leaks into another org's lookup", async () => {
    findUniqueOrgRolePermissionSet.mockResolvedValueOnce({ permissions: [PERMISSIONS.MEMBERS_READ] });
    findUniqueOrgRolePermissionSet.mockResolvedValueOnce(null);
    const { roleRequiresAdministrativeSeat } = await import("../admin-seat-policy");
    expect(await roleRequiresAdministrativeSeat("org-trimmed", "STAFF")).toBe(false);
    expect(await roleRequiresAdministrativeSeat("org-default", "STAFF")).toBe(true);
  });
});
