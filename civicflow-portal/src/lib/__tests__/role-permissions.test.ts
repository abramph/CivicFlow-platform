import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOverride = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgRolePermissionSet: {
      findUnique: (...args: unknown[]) => findUniqueOverride(...args),
    },
  },
}));

import { permissionsFor, PERMISSIONS } from "@/lib/rbac";
import { canDoForOrg, getEffectivePermissions, isCustomizableRole } from "@/lib/role-permissions";

describe("getEffectivePermissions: hard safety rails", () => {
  beforeEach(() => {
    findUniqueOverride.mockReset();
  });

  it("SUPER_ADMIN always gets the full default set, even if a (bogus) override row exists", async () => {
    findUniqueOverride.mockResolvedValueOnce({ permissions: [] });
    const result = await getEffectivePermissions("org-a", "SUPER_ADMIN");
    expect(result).toEqual(permissionsFor("SUPER_ADMIN"));
    expect(findUniqueOverride).not.toHaveBeenCalled();
  });

  it("ORG_OWNER always gets the full owner default set, never a customized/reduced one", async () => {
    findUniqueOverride.mockResolvedValueOnce({ permissions: [] });
    const result = await getEffectivePermissions("org-a", "ORG_OWNER");
    expect(result).toEqual(permissionsFor("ORG_OWNER"));
    expect(findUniqueOverride).not.toHaveBeenCalled();
  });

  it("MEMBER always gets zero permissions, even if an override row somehow exists", async () => {
    findUniqueOverride.mockResolvedValueOnce({ permissions: [PERMISSIONS.MEMBERS_READ, PERMISSIONS.DUES_WRITE] });
    const result = await getEffectivePermissions("org-a", "MEMBER");
    expect(result).toEqual([]);
    expect(findUniqueOverride).not.toHaveBeenCalled();
  });

  it("a customizable role falls back to its hardcoded default when no override row exists", async () => {
    findUniqueOverride.mockResolvedValueOnce(null);
    const result = await getEffectivePermissions("org-a", "FINANCE");
    expect(result).toEqual(permissionsFor("FINANCE"));
  });

  it("a customizable role uses the org's saved override when one exists", async () => {
    findUniqueOverride.mockResolvedValueOnce({ permissions: [PERMISSIONS.DUES_READ] });
    const result = await getEffectivePermissions("org-a", "FINANCE");
    expect(result).toEqual([PERMISSIONS.DUES_READ]);
  });

  it("an intentional empty override is respected, not treated as 'no override'", async () => {
    findUniqueOverride.mockResolvedValueOnce({ permissions: [] });
    const result = await getEffectivePermissions("org-a", "STAFF");
    expect(result).toEqual([]);
    expect(result).not.toEqual(permissionsFor("STAFF"));
  });

  it("only ORG_ADMIN, FINANCE, STAFF, READ_ONLY are customizable", () => {
    expect(isCustomizableRole("ORG_ADMIN")).toBe(true);
    expect(isCustomizableRole("FINANCE")).toBe(true);
    expect(isCustomizableRole("STAFF")).toBe(true);
    expect(isCustomizableRole("READ_ONLY")).toBe(true);
    expect(isCustomizableRole("ORG_OWNER")).toBe(false);
    expect(isCustomizableRole("SUPER_ADMIN")).toBe(false);
    expect(isCustomizableRole("MEMBER")).toBe(false);
  });
});

describe("canDoForOrg", () => {
  beforeEach(() => {
    findUniqueOverride.mockReset();
  });

  it("SUPER_ADMIN can do anything without even resolving an override", async () => {
    const result = await canDoForOrg("org-a", "SUPER_ADMIN", PERMISSIONS.ALL_ORGS_MANAGE);
    expect(result).toBe(true);
    expect(findUniqueOverride).not.toHaveBeenCalled();
  });

  it("respects a narrowed override for a customizable role", async () => {
    findUniqueOverride.mockResolvedValueOnce({ permissions: [PERMISSIONS.DUES_READ] });
    expect(await canDoForOrg("org-a", "FINANCE", PERMISSIONS.DUES_READ)).toBe(true);
    findUniqueOverride.mockResolvedValueOnce({ permissions: [PERMISSIONS.DUES_READ] });
    expect(await canDoForOrg("org-a", "FINANCE", PERMISSIONS.DUES_WRITE)).toBe(false);
  });
});
