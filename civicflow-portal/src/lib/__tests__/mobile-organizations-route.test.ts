import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMembership = vi.fn();
const findManyOrgMember = vi.fn();
const findManyHouseholdAdult = vi.fn();
const findUniqueUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: { findMany: (...args: unknown[]) => findManyMembership(...args) },
    orgMember: { findMany: (...args: unknown[]) => findManyOrgMember(...args) },
    ptaHouseholdAdult: { findMany: (...args: unknown[]) => findManyHouseholdAdult(...args) },
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
  },
}));

const getOrganizationLabAccess = vi.fn();
vi.mock("@/lib/labs/access", () => ({
  getOrganizationLabAccess: (...args: unknown[]) => getOrganizationLabAccess(...args),
}));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

import { GET } from "@/app/api/mobile/organizations/route";
import { signAccessToken } from "@/lib/mobile-auth";

function request() {
  return new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: "Bearer test-token" } });
}

beforeEach(() => {
  findManyMembership.mockReset();
  findManyOrgMember.mockReset();
  findManyHouseholdAdult.mockReset();
  findUniqueUser.mockReset();
  getOrganizationLabAccess.mockReset();
  getEffectivePermissions.mockReset();
  findUniqueUser.mockResolvedValue({ id: "user-1", email: "user@example.com", mobileTokenVersion: 0 });
});

describe("GET /api/mobile/organizations", () => {
  it("still returns a regular MEMBER-role org exactly as before (no regression)", async () => {
    findManyMembership.mockResolvedValueOnce([
      { organizationId: "org-a", organization: { id: "org-a", name: "Sample Org", logoUrl: null }, joinedAt: new Date() },
    ]);
    findManyOrgMember.mockResolvedValueOnce([{ id: "member-1", organizationId: "org-a", firstName: "Jamie", lastName: "Lee", membershipStatus: "active", isDelinquent: false }]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    // staff-membership query reuses the same mock; second call returns empty
    findManyMembership.mockResolvedValueOnce([]);

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([
      expect.objectContaining({ organizationId: "org-a", memberId: "member-1", firstName: "Jamie", pta: null }),
    ]);
  });

  it("returns a pure PTA parent's org even with zero OrganizationMembership rows — the load-bearing fix", async () => {
    findManyMembership.mockResolvedValueOnce([]); // no MEMBER-role memberships
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([
      { id: "adult-1", organizationId: "org-pta", name: "Casey Kim", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null } },
    ]);
    findManyMembership.mockResolvedValueOnce([]); // no staff memberships either

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([
      expect.objectContaining({
        organizationId: "org-pta",
        memberId: null,
        firstName: "Casey",
        pta: expect.objectContaining({ householdAdultId: "adult-1", isOfficer: false }),
      }),
    ]);
  });

  it("surfaces a PTA officer org only when they hold checkin or hours-approve permission there", async () => {
    findManyMembership
      .mockResolvedValueOnce([]) // MEMBER-role query
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "STAFF", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    getOrganizationLabAccess.mockResolvedValueOnce({ available: true });
    getEffectivePermissions.mockResolvedValueOnce(["pta:volunteers:checkin"]);

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([
      expect.objectContaining({ organizationId: "org-pta", pta: expect.objectContaining({ isOfficer: true, canCheckIn: true, canApproveHours: false }) }),
    ]);
  });

  it("excludes a staff member with no PTA-relevant permission — officer admin with nothing to do here shouldn't appear", async () => {
    findManyMembership
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "FINANCE", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    getOrganizationLabAccess.mockResolvedValueOnce({ available: true });
    getEffectivePermissions.mockResolvedValueOnce(["pta:dues:manage"]); // no checkin/approve

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([]);
  });

  it("merges a single org that is BOTH a household adult AND an officer identity into one row", async () => {
    findManyMembership
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "ORG_OWNER", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([
      { id: "adult-1", organizationId: "org-pta", name: "Alex Morgan", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null } },
    ]);
    getOrganizationLabAccess.mockResolvedValueOnce({ available: true });
    getEffectivePermissions.mockResolvedValueOnce(["pta:volunteers:checkin", "pta:volunteer-hours:approve"]);

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        organizationId: "org-pta",
        pta: expect.objectContaining({ householdAdultId: "adult-1", isOfficer: true, canCheckIn: true, canApproveHours: true }),
      })
    );
  });
});
