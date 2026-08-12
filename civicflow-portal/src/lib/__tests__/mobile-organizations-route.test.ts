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

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

const resolveMobileAdminCapabilities = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  resolveMobileAdminCapabilities: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

import { GET } from "@/app/api/mobile/organizations/route";
import { signAccessToken } from "@/lib/mobile-auth";

const NO_ADMIN_ACCESS = { available: false, role: null, adminCapabilities: [] };

function request() {
  return new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: "Bearer test-token" } });
}

beforeEach(() => {
  findManyMembership.mockReset();
  findManyOrgMember.mockReset();
  findManyHouseholdAdult.mockReset();
  findUniqueUser.mockReset();
  getEffectivePermissions.mockReset();
  resolveMobileAdminCapabilities.mockReset();
  resolveMobileAdminCapabilities.mockResolvedValue(NO_ADMIN_ACCESS);
  findUniqueUser.mockResolvedValue({ id: "user-1", email: "user@example.com", mobileTokenVersion: 0 });
  // Fallbacks so a test only has to describe the calls it cares about. The
  // route now makes a second orgMember.findMany — the role-agnostic pass that
  // resolves a constituent identity for staff/owner rows — which would
  // otherwise fall off the end of the mockResolvedValueOnce queue.
  findManyMembership.mockResolvedValue([]);
  findManyOrgMember.mockResolvedValue([]);
  findManyHouseholdAdult.mockResolvedValue([]);
});

describe("GET /api/mobile/organizations", () => {
  it("still returns a regular MEMBER-role org exactly as before (no regression)", async () => {
    findManyMembership.mockResolvedValueOnce([
      { organizationId: "org-a", organization: { id: "org-a", name: "Sample Org", logoUrl: null, primaryVertical: "COMMUNITY" }, joinedAt: new Date() },
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
    expect(body.data[0].capability).toEqual(
      expect.objectContaining({ primaryVertical: "COMMUNITY", landingPage: "dashboard" })
    );
    expect(body.data[0].capability.supportedModules).not.toContain("volunteers");
  });

  it("returns a pure PTA parent's org even with zero OrganizationMembership rows — the load-bearing fix (PR #40: gated on primaryVertical, not Labs)", async () => {
    findManyMembership.mockResolvedValueOnce([]); // no MEMBER-role memberships
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([
      { id: "adult-1", organizationId: "org-pta", name: "Casey Kim", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, primaryVertical: "PTA" } },
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
    expect(body.data[0].capability).toEqual(
      expect.objectContaining({ primaryVertical: "PTA", terminology: expect.objectContaining({ member: "Parent" }) })
    );
    expect(body.data[0].capability.supportedModules).toContain("volunteers");
  });

  it("excludes a household adult's org entirely when it isn't PTA-vertical — capability must not outlive the org's actual vertical", async () => {
    findManyMembership.mockResolvedValueOnce([]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([
      { id: "adult-1", organizationId: "org-pta", name: "Casey Kim", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, primaryVertical: "COMMUNITY" } },
    ]);
    findManyMembership.mockResolvedValueOnce([]);

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([]);
  });

  it("surfaces a PTA officer org only when they hold checkin or hours-approve permission there", async () => {
    findManyMembership
      .mockResolvedValueOnce([]) // MEMBER-role query
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "STAFF", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active", primaryVertical: "PTA" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
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
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "FINANCE", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active", primaryVertical: "PTA" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    getEffectivePermissions.mockResolvedValueOnce(["pta:dues:manage"]); // no checkin/approve

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([]);
  });

  it("excludes a staff member from a non-PTA-vertical org even if their role would otherwise hold PTA permissions", async () => {
    findManyMembership
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-a", role: "STAFF", organization: { id: "org-a", name: "Sample Org", logoUrl: null, status: "active", primaryVertical: "COMMUNITY" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([]);
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it("merges a single org that is BOTH a household adult AND an officer identity into one row", async () => {
    findManyMembership
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "ORG_OWNER", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active", primaryVertical: "PTA" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([
      { id: "adult-1", organizationId: "org-pta", name: "Alex Morgan", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, primaryVertical: "PTA" } },
    ]);
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

  it("surfaces a non-PTA officer's org via general adminCapabilities alone — the Mobile Admin program's load-bearing fix (a Community/HOA/Union officer with no PTA signal and no personal OrgMember previously got zero rows at all)", async () => {
    findManyMembership
      .mockResolvedValueOnce([]) // MEMBER-role query
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-hoa", role: "ORG_OWNER", organization: { id: "org-hoa", name: "Oak Ridge HOA", logoUrl: null, status: "active", primaryVertical: "HOA" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["adminDashboard", "manageHoaProperties"] });

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual(expect.objectContaining({ organizationId: "org-hoa", pta: null }));
    expect(body.data[0].capability.adminCapabilities).toEqual(["adminDashboard", "manageHoaProperties"]);
    expect(body.data[0].capability.supportedModules).toContain("admin");
    // getEffectivePermissions is only called on the PTA-only checkin/approve
    // path — a non-PTA org must never invoke it directly from this route.
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it("excludes a staff member's org entirely when resolveMobileAdminCapabilities returns unavailable and there's no PTA signal either", async () => {
    findManyMembership
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-hoa", role: "STAFF", organization: { id: "org-hoa", name: "Oak Ridge HOA", logoUrl: null, status: "active", primaryVertical: "HOA" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toEqual([]);
  });

  it("merges PTA officer signal AND general adminCapabilities into the same row when both are present for the same org", async () => {
    findManyMembership
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "ORG_OWNER", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active", primaryVertical: "PTA" } }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    getEffectivePermissions.mockResolvedValueOnce(["pta:volunteers:checkin"]);
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["adminDashboard", "managePtaVolunteers"] });

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].pta).toEqual(expect.objectContaining({ isOfficer: true, canCheckIn: true }));
    expect(body.data[0].capability.adminCapabilities).toEqual(["adminDashboard", "managePtaVolunteers"]);
  });

  it("does not surface adminCapabilities for a plain member/PTA-parent row with no staff membership at all", async () => {
    findManyMembership.mockResolvedValueOnce([
      { organizationId: "org-a", organization: { id: "org-a", name: "Sample Org", logoUrl: null, primaryVertical: "COMMUNITY" }, joinedAt: new Date() },
    ]);
    findManyOrgMember.mockResolvedValueOnce([{ id: "member-1", organizationId: "org-a", firstName: "Jamie", lastName: "Lee", membershipStatus: "active", isDelinquent: false }]);
    findManyHouseholdAdult.mockResolvedValueOnce([]);
    findManyMembership.mockResolvedValueOnce([]); // no staff memberships

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data[0].capability.adminCapabilities).toEqual([]);
    expect(body.data[0].capability.supportedModules).not.toContain("admin");
    expect(resolveMobileAdminCapabilities).not.toHaveBeenCalled();
  });
});

/**
 * Administrative role and constituent identity are separate concepts, and a
 * login may hold both. Because OrganizationMembership is unique per (user,
 * org), that dual identity is necessarily expressed as a staff-role membership
 * PLUS an OrgMember linked by userId — never two membership rows. The staff
 * branch used to hardcode memberId: null, so such a user reported no member
 * identity and every member-facing screen went dark for them.
 */
describe("GET /api/mobile/organizations — dual identity (staff/owner who is also a member)", () => {
  const ownerMembership = {
    id: "membership-owner",
    organizationId: "org-a",
    role: "ORG_OWNER",
    organization: { id: "org-a", name: "APH Technologies, LLC", logoUrl: null, status: "active", primaryVertical: "COMMUNITY" },
  };

  it("resolves memberId for an ORG_OWNER who has a linked OrgMember", async () => {
    findManyMembership.mockResolvedValueOnce([]).mockResolvedValueOnce([ownerMembership]);
    findManyOrgMember
      .mockResolvedValueOnce([]) // MEMBER-role branch finds nothing
      .mockResolvedValueOnce([{ id: "member-owner", organizationId: "org-a", firstName: "Abram", lastName: "Harris", membershipStatus: "active", isDelinquent: false }]);
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["adminDashboard"] });

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual(
      expect.objectContaining({ organizationId: "org-a", memberId: "member-owner", firstName: "Abram", lastName: "Harris" })
    );
    // Administrative capability is unaffected — the two identities coexist.
    expect(body.data[0].capability.adminCapabilities).toEqual(["adminDashboard"]);
  });

  it("resolves memberId for a STAFF login who has a linked OrgMember", async () => {
    findManyMembership.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...ownerMembership, id: "membership-staff", role: "STAFF" }]);
    findManyOrgMember
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "member-staff", organizationId: "org-a", firstName: "Sam", lastName: "Reed", membershipStatus: "active", isDelinquent: false }]);
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["adminDashboard"] });

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data[0]).toEqual(expect.objectContaining({ memberId: "member-staff", firstName: "Sam" }));
  });

  it("leaves memberId null for a staff/owner with no linked OrgMember", async () => {
    findManyMembership.mockResolvedValueOnce([]).mockResolvedValueOnce([ownerMembership]);
    findManyOrgMember.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_OWNER", adminCapabilities: ["adminDashboard"] });

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data[0]).toEqual(expect.objectContaining({ organizationId: "org-a", memberId: null }));
  });

  it("keeps a conventional MEMBER's memberId resolved by the original branch, not the fallback pass", async () => {
    findManyMembership
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-b", role: "MEMBER", joinedAt: new Date(0), organization: { id: "org-b", name: "Riverdale", logoUrl: null, primaryVertical: "COMMUNITY" } }])
      .mockResolvedValueOnce([]);
    findManyOrgMember.mockResolvedValueOnce([
      { id: "member-1", organizationId: "org-b", firstName: "Jamie", lastName: "Lee", membershipStatus: "active", isDelinquent: false },
    ]);

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data[0]).toEqual(expect.objectContaining({ memberId: "member-1" }));
    // Nothing was left unresolved, so the second lookup never runs.
    expect(findManyOrgMember).toHaveBeenCalledTimes(1);
  });

  it("gives a PTA officer who is also a household adult BOTH identities, without clobbering the adult's own name", async () => {
    findManyMembership
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "membership-1", organizationId: "org-pta", role: "ORG_OWNER", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, status: "active", primaryVertical: "PTA" } }]);
    findManyHouseholdAdult.mockResolvedValueOnce([
      { id: "adult-1", organizationId: "org-pta", name: "Alex Morgan", organization: { id: "org-pta", name: "Pine Grove School PTA", logoUrl: null, primaryVertical: "PTA" } },
    ]);
    findManyOrgMember
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "member-officer", organizationId: "org-pta", firstName: "Alexandra", lastName: "Morgan-Smith", membershipStatus: "active", isDelinquent: false }]);
    getEffectivePermissions.mockResolvedValueOnce(["pta:volunteers:checkin", "pta:volunteer-hours:approve"]);

    const token = await signAccessToken("user-1", 0);
    const response = await GET(new Request("https://portal.test/api/mobile/organizations", { headers: { Authorization: `Bearer ${token}` } }));
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        memberId: "member-officer",
        // The household adult's own display name wins over the constituent record's.
        firstName: "Alex",
        pta: expect.objectContaining({ householdAdultId: "adult-1", isOfficer: true, canCheckIn: true }),
      })
    );
  });
});
