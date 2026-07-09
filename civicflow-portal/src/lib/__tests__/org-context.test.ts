import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMembership = vi.fn();
const findManyOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: {
      findMany: (...args: unknown[]) => findManyMembership(...args),
    },
    orgMember: {
      findMany: (...args: unknown[]) => findManyOrgMember(...args),
    },
  },
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
    getCookie.mockReset();
  });

  it("returns an empty list when the user has no active memberships", async () => {
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
      },
      {
        organizationId: "org-b",
        organizationName: "Org B",
        organizationLogoUrl: "https://example.com/logo.png",
        role: "ORG_ADMIN",
        memberId: null,
        memberStatus: null,
      },
    ]);
  });
});

describe("resolveActiveOrganization", () => {
  beforeEach(() => {
    findManyMembership.mockReset();
    findManyOrgMember.mockReset();
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
