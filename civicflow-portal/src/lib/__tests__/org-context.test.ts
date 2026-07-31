import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMembership = vi.fn();
const findManyOrgMember = vi.fn();
const findManyPtaHouseholdAdult = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: {
      findMany: (...args: unknown[]) => findManyMembership(...args),
    },
    orgMember: {
      findMany: (...args: unknown[]) => findManyOrgMember(...args),
    },
    ptaHouseholdAdult: {
      findMany: (...args: unknown[]) => findManyPtaHouseholdAdult(...args),
    },
  },
}));

const getOrganizationLabAccess = vi.fn();
vi.mock("@/lib/labs/access", () => ({
  getOrganizationLabAccess: (...args: unknown[]) => getOrganizationLabAccess(...args),
}));

const getCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: getCookie }),
}));

import { getUserOrgMemberships, resolveActiveOrganization, ACTIVE_ORG_COOKIE } from "@/lib/org-context";

function membershipRow(overrides: Partial<{
  organizationId: string;
  role: string;
  joinedAt: Date;
  organization: { id: string; name: string; logoUrl: string | null };
}> = {}) {
  return {
    organizationId: "org-a",
    role: "STAFF",
    joinedAt: new Date("2024-01-01"),
    organization: { id: "org-a", name: "Org A", logoUrl: null },
    ...overrides,
  };
}

describe("getUserOrgMemberships", () => {
  beforeEach(() => {
    findManyMembership.mockReset();
    findManyOrgMember.mockReset();
    findManyPtaHouseholdAdult.mockReset().mockResolvedValue([]);
    getOrganizationLabAccess.mockReset();
    getCookie.mockReset();
  });

  it("returns an empty list when the user has no active memberships or PTA households", async () => {
    findManyMembership.mockResolvedValueOnce([]);

    const result = await getUserOrgMemberships("user-1");

    expect(result).toEqual([]);
    expect(findManyOrgMember).not.toHaveBeenCalled();
  });

  it("only queries active memberships in active organizations", async () => {
    findManyMembership.mockResolvedValueOnce([]);

    await getUserOrgMemberships("user-1");

    expect(findManyMembership).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "active", organization: { status: "active" } },
      })
    );
  });

  it("attaches memberId/memberStatus from OrgMember when a constituent record exists", async () => {
    findManyMembership.mockResolvedValueOnce([
      membershipRow({ organizationId: "org-a", role: "MEMBER" }),
      membershipRow({
        organizationId: "org-b",
        role: "ORG_ADMIN",
        organization: { id: "org-b", name: "Org B", logoUrl: "https://example.com/logo.png" },
      }),
    ]);
    findManyOrgMember.mockResolvedValueOnce([
      { id: "member-1", organizationId: "org-a", membershipStatus: "active" },
    ]);

    const result = await getUserOrgMemberships("user-1");

    expect(result).toEqual([
      {
        organizationId: "org-a",
        organizationName: "Org A",
        organizationLogoUrl: null,
        role: "MEMBER",
        memberId: "member-1",
        memberStatus: "active",
        isPtaHouseholdOnly: false,
      },
      {
        organizationId: "org-b",
        organizationName: "Org B",
        organizationLogoUrl: "https://example.com/logo.png",
        role: "ORG_ADMIN",
        memberId: null,
        memberStatus: null,
        isPtaHouseholdOnly: false,
      },
    ]);
  });

  it("adds a synthetic MEMBER entry for a PTA household adult with no OrganizationMembership, when the org has ptaVertical access", async () => {
    findManyMembership.mockResolvedValueOnce([]);
    findManyPtaHouseholdAdult.mockReset().mockResolvedValueOnce([
      {
        organizationId: "org-pta",
        createdAt: new Date("2024-03-01"),
        organization: { id: "org-pta", name: "Pine Grove PTA", logoUrl: null },
      },
    ]);
    getOrganizationLabAccess.mockResolvedValueOnce({ available: true });

    const result = await getUserOrgMemberships("user-parent");

    expect(getOrganizationLabAccess).toHaveBeenCalledWith("org-pta", "ptaVertical");
    expect(findManyOrgMember).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        organizationId: "org-pta",
        organizationName: "Pine Grove PTA",
        organizationLogoUrl: null,
        role: "MEMBER",
        memberId: null,
        memberStatus: null,
        isPtaHouseholdOnly: true,
      },
    ]);
  });

  it("excludes a PTA household adult entry when the org's ptaVertical access is unavailable", async () => {
    findManyMembership.mockResolvedValueOnce([]);
    findManyPtaHouseholdAdult.mockReset().mockResolvedValueOnce([
      {
        organizationId: "org-pta",
        createdAt: new Date("2024-03-01"),
        organization: { id: "org-pta", name: "Pine Grove PTA", logoUrl: null },
      },
    ]);
    getOrganizationLabAccess.mockResolvedValueOnce({ available: false });

    const result = await getUserOrgMemberships("user-parent");

    expect(result).toEqual([]);
  });

  it("does not duplicate an org where the user already has a real OrganizationMembership and is also a household adult", async () => {
    findManyMembership.mockResolvedValueOnce([
      membershipRow({
        organizationId: "org-pta",
        role: "STAFF",
        organization: { id: "org-pta", name: "Pine Grove PTA", logoUrl: null },
      }),
    ]);
    findManyOrgMember.mockResolvedValueOnce([]);
    findManyPtaHouseholdAdult.mockReset().mockResolvedValueOnce([
      {
        organizationId: "org-pta",
        createdAt: new Date("2024-03-01"),
        organization: { id: "org-pta", name: "Pine Grove PTA", logoUrl: null },
      },
    ]);

    const result = await getUserOrgMemberships("user-president");

    expect(getOrganizationLabAccess).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        organizationId: "org-pta",
        organizationName: "Pine Grove PTA",
        organizationLogoUrl: null,
        role: "STAFF",
        memberId: null,
        memberStatus: null,
        isPtaHouseholdOnly: false,
      },
    ]);
  });

  it("reports a conventional membership's RAW stored vertical, not reconciled against Labs — this list is read on every session hydration for every org, so reconciling each entry would mean a Labs-access query per org per session read; only the active org gets reconciled (see resolveSessionIdentity)", async () => {
    findManyMembership.mockResolvedValueOnce([
      membershipRow({ organizationId: "org-pta", organization: { id: "org-pta", name: "Pine Grove PTA", logoUrl: null, primaryVertical: "PTA" } as never }),
    ]);
    findManyOrgMember.mockResolvedValueOnce([]);

    const result = await getUserOrgMemberships("user-staff");

    expect(result[0].primaryVertical).toBe("PTA");
    expect(getOrganizationLabAccess).not.toHaveBeenCalled();
  });
});

describe("resolveActiveOrganization", () => {
  beforeEach(() => {
    findManyMembership.mockReset();
    findManyOrgMember.mockReset();
    findManyPtaHouseholdAdult.mockReset().mockResolvedValue([]);
    getOrganizationLabAccess.mockReset();
    getCookie.mockReset();
    getCookie.mockReturnValue(undefined);
  });

  it("returns null when the user has zero memberships", async () => {
    findManyMembership.mockResolvedValueOnce([]);

    const result = await resolveActiveOrganization("user-1");

    expect(result).toBeNull();
  });

  it("falls back to the oldest membership when no requestedOrgId or cookie is set", async () => {
    findManyMembership.mockResolvedValueOnce([
      membershipRow({ organizationId: "org-old", joinedAt: new Date("2023-01-01") }),
      membershipRow({ organizationId: "org-new", joinedAt: new Date("2024-06-01") }),
    ]);
    findManyOrgMember.mockResolvedValueOnce([]);

    const result = await resolveActiveOrganization("user-1");

    expect(result?.organizationId).toBe("org-old");
  });

  it("prefers a valid requestedOrgId over the cookie and the oldest membership", async () => {
    findManyMembership.mockResolvedValueOnce([
      membershipRow({ organizationId: "org-old", joinedAt: new Date("2023-01-01") }),
      membershipRow({ organizationId: "org-new", joinedAt: new Date("2024-06-01") }),
    ]);
    findManyOrgMember.mockResolvedValueOnce([]);
    getCookie.mockReturnValue({ value: "org-old" });

    const result = await resolveActiveOrganization("user-1", "org-new");

    expect(result?.organizationId).toBe("org-new");
  });

  it("ignores an invalid requestedOrgId the user doesn't belong to, falling back to the cookie", async () => {
    findManyMembership.mockResolvedValueOnce([
      membershipRow({ organizationId: "org-old", joinedAt: new Date("2023-01-01") }),
      membershipRow({ organizationId: "org-new", joinedAt: new Date("2024-06-01") }),
    ]);
    findManyOrgMember.mockResolvedValueOnce([]);
    getCookie.mockReturnValue({ value: "org-new" });

    const result = await resolveActiveOrganization("user-1", "org-not-a-member-of");

    expect(getCookie).toHaveBeenCalledWith(ACTIVE_ORG_COOKIE);
    expect(result?.organizationId).toBe("org-new");
  });

  it("ignores an invalid/stale cookie value, falling back to the oldest membership", async () => {
    findManyMembership.mockResolvedValueOnce([
      membershipRow({ organizationId: "org-old", joinedAt: new Date("2023-01-01") }),
      membershipRow({ organizationId: "org-new", joinedAt: new Date("2024-06-01") }),
    ]);
    findManyOrgMember.mockResolvedValueOnce([]);
    getCookie.mockReturnValue({ value: "org-stale-no-longer-a-member" });

    const result = await resolveActiveOrganization("user-1");

    expect(result?.organizationId).toBe("org-old");
  });
});
