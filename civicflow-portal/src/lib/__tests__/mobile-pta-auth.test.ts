import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstMembership = vi.fn();
const findFirstHouseholdAdult = vi.fn();
const findFirstOrgMember = vi.fn();
const findUniqueUser = vi.fn();
const countMembership = vi.fn();
const countPtaHouseholdAdult = vi.fn();
const requireOrgLabFeature = vi.fn();
const getEffectivePermissionsMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: {
      findFirst: (...args: unknown[]) => findFirstMembership(...args),
      count: (...args: unknown[]) => countMembership(...args),
    },
    ptaHouseholdAdult: {
      findFirst: (...args: unknown[]) => findFirstHouseholdAdult(...args),
      count: (...args: unknown[]) => countPtaHouseholdAdult(...args),
    },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
  },
}));

vi.mock("@/lib/labs/access", () => ({
  requireOrganizationLabFeature: (...args: unknown[]) => requireOrgLabFeature(...args),
}));

vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissionsMock(...args),
}));

import { completeMobileLogin, requireMobileOrgAccess, requireMobilePtaHouseholdAccess, requireMobileStaffPermission, signAccessToken } from "@/lib/mobile-auth";

function requestWithToken(token: string) {
  return new Request("https://portal.test/api/mobile/pta/volunteers/opportunities", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  findFirstMembership.mockReset();
  findFirstHouseholdAdult.mockReset();
  findFirstOrgMember.mockReset();
  findUniqueUser.mockReset();
  countMembership.mockReset();
  countPtaHouseholdAdult.mockReset();
  requireOrgLabFeature.mockReset();
  getEffectivePermissionsMock.mockReset();
});

describe("completeMobileLogin — PTA household adults must be able to obtain a mobile token", () => {
  const user = { id: "user-1", email: "parent@example.com", displayName: "Casey Kim", mobileTokenVersion: 0 };

  it("issues a token pair for a pure PTA parent with zero OrganizationMembership rows", async () => {
    countMembership.mockResolvedValueOnce(0);
    countPtaHouseholdAdult.mockResolvedValueOnce(1);

    const result = await completeMobileLogin(user);

    expect(result.ok).toBe(true);
  });

  it("still issues a token pair for a regular MEMBER-role account (existing behavior preserved)", async () => {
    countMembership.mockResolvedValueOnce(1);
    countPtaHouseholdAdult.mockResolvedValueOnce(0);

    const result = await completeMobileLogin(user);

    expect(result.ok).toBe(true);
  });

  it("rejects an account that is neither a MEMBER nor a linked PTA household adult", async () => {
    countMembership.mockResolvedValueOnce(0);
    countPtaHouseholdAdult.mockResolvedValueOnce(0);

    const result = await completeMobileLogin(user);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("requireMobilePtaHouseholdAccess — parent-side mobile PTA guard", () => {
  it("resolves the caller's own household adult when PTA is enrolled and the household is active", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "parent@example.com", mobileTokenVersion: 0 });
    requireOrgLabFeature.mockResolvedValueOnce(undefined);
    findFirstHouseholdAdult.mockResolvedValueOnce({ id: "adult-1", household: { id: "household-1", status: "ACTIVE" } });

    const token = await signAccessToken("user-1", 0);
    const result = await requireMobilePtaHouseholdAccess(requestWithToken(token), "org-a");

    expect(result.adult).toEqual({ id: "adult-1", householdId: "household-1" });
    expect(findFirstHouseholdAdult).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", userId: "user-1" } })
    );
  });

  it("denies access when the organization is not enrolled in the PTA vertical", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "parent@example.com", mobileTokenVersion: 0 });
    requireOrgLabFeature.mockRejectedValueOnce(new Error("not enrolled"));

    const token = await signAccessToken("user-1", 0);
    await expect(requireMobilePtaHouseholdAccess(requestWithToken(token), "org-a")).rejects.toThrow(/not available/);
    expect(findFirstHouseholdAdult).not.toHaveBeenCalled();
  });

  it("denies a caller with no linked PtaHouseholdAdult in this organization — even if they belong to a PTA household elsewhere", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "parent@example.com", mobileTokenVersion: 0 });
    requireOrgLabFeature.mockResolvedValueOnce(undefined);
    findFirstHouseholdAdult.mockResolvedValueOnce(null);

    const token = await signAccessToken("user-1", 0);
    await expect(requireMobilePtaHouseholdAccess(requestWithToken(token), "org-a")).rejects.toThrow(/not linked to a PTA household/);
  });

  it("denies a caller whose household has been deactivated", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "parent@example.com", mobileTokenVersion: 0 });
    requireOrgLabFeature.mockResolvedValueOnce(undefined);
    findFirstHouseholdAdult.mockResolvedValueOnce({ id: "adult-1", household: { id: "household-1", status: "INACTIVE" } });

    const token = await signAccessToken("user-1", 0);
    await expect(requireMobilePtaHouseholdAccess(requestWithToken(token), "org-a")).rejects.toThrow(/not currently active/);
  });
});

describe("requireMobileStaffPermission — officer-side mobile PTA guard", () => {
  it("grants access when the caller's role in this org has the requested permission", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "officer-1", email: "coordinator@example.com", mobileTokenVersion: 0 });
    findFirstMembership.mockResolvedValueOnce({ id: "membership-1", organizationId: "org-a", userId: "officer-1", role: "STAFF" });
    requireOrgLabFeature.mockResolvedValueOnce(undefined);
    getEffectivePermissionsMock.mockResolvedValueOnce(["pta:volunteers:checkin"]);

    const token = await signAccessToken("officer-1", 0);
    const result = await requireMobileStaffPermission(requestWithToken(token), "org-a", "pta:volunteers:checkin" as never);

    expect(result.role).toBe("STAFF");
    expect(findFirstMembership).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a", userId: "officer-1", role: { not: "MEMBER" } }) })
    );
  });

  it("denies a plain PTA parent (no OrganizationMembership row) from any officer route", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "parent-1", email: "parent@example.com", mobileTokenVersion: 0 });
    findFirstMembership.mockResolvedValueOnce(null);

    const token = await signAccessToken("parent-1", 0);
    await expect(requireMobileStaffPermission(requestWithToken(token), "org-a", "pta:volunteers:checkin" as never)).rejects.toThrow(
      /No active staff membership/
    );
    expect(requireOrgLabFeature).not.toHaveBeenCalled();
  });

  it("denies a staff member who holds a different permission than the one required", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "officer-1", email: "coordinator@example.com", mobileTokenVersion: 0 });
    findFirstMembership.mockResolvedValueOnce({ id: "membership-1", organizationId: "org-a", userId: "officer-1", role: "STAFF" });
    requireOrgLabFeature.mockResolvedValueOnce(undefined);
    getEffectivePermissionsMock.mockResolvedValueOnce(["pta:volunteers:manage"]); // does not include checkin

    const token = await signAccessToken("officer-1", 0);
    await expect(
      requireMobileStaffPermission(requestWithToken(token), "org-a", "pta:volunteers:checkin" as never)
    ).rejects.toThrow(/Permission denied/);
  });

  it("denies access when the organization is not enrolled in the PTA vertical, even for a real officer", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "officer-1", email: "coordinator@example.com", mobileTokenVersion: 0 });
    findFirstMembership.mockResolvedValueOnce({ id: "membership-1", organizationId: "org-a", userId: "officer-1", role: "ORG_OWNER" });
    requireOrgLabFeature.mockRejectedValueOnce(new Error("not enrolled"));

    const token = await signAccessToken("officer-1", 0);
    await expect(
      requireMobileStaffPermission(requestWithToken(token), "org-a", "pta:volunteers:checkin" as never)
    ).rejects.toThrow(/not available/);
    expect(getEffectivePermissionsMock).not.toHaveBeenCalled();
  });
});

describe("requireMobileOrgAccess — the loosest guard, for userId-scoped features like messaging", () => {
  it("grants access via a regular MEMBER-role membership and resolves memberId", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com", mobileTokenVersion: 0 });
    findFirstMembership
      .mockResolvedValueOnce({ id: "membership-1", organizationId: "org-a", role: "MEMBER" }) // MEMBER-role lookup
      .mockResolvedValueOnce(null); // staff-role lookup
    findFirstHouseholdAdult.mockResolvedValueOnce(null);
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });

    const token = await signAccessToken("user-1", 0);
    const result = await requireMobileOrgAccess(requestWithToken(token), "org-a");

    expect(result.memberId).toBe("member-1");
  });

  it("grants access via a PTA household-adult link alone, with memberId: null — no personal OrgMember exists", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "parent-1", email: "parent@example.com", mobileTokenVersion: 0 });
    findFirstMembership.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    findFirstHouseholdAdult.mockResolvedValueOnce({ id: "adult-1" });

    const token = await signAccessToken("parent-1", 0);
    const result = await requireMobileOrgAccess(requestWithToken(token), "org-a");

    expect(result.memberId).toBeNull();
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("grants access via a staff-role membership alone (an officer with no household link and no MEMBER row)", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "officer-1", email: "officer@example.com", mobileTokenVersion: 0 });
    findFirstMembership.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "membership-1", role: "ORG_OWNER" });
    findFirstHouseholdAdult.mockResolvedValueOnce(null);

    const token = await signAccessToken("officer-1", 0);
    const result = await requireMobileOrgAccess(requestWithToken(token), "org-a");

    expect(result.memberId).toBeNull();
  });

  it("denies a caller with none of the three identities in this organization", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "stranger-1", email: "stranger@example.com", mobileTokenVersion: 0 });
    findFirstMembership.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    findFirstHouseholdAdult.mockResolvedValueOnce(null);

    const token = await signAccessToken("stranger-1", 0);
    await expect(requireMobileOrgAccess(requestWithToken(token), "org-a")).rejects.toThrow(/No active access/);
  });
});
