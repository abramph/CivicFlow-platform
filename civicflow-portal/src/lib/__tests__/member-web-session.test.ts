import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => getServerSession(...args) }));
vi.mock("@/lib/authOptions", () => ({ authOptions: {} }));

const getUserOrgMemberships = vi.fn();
vi.mock("@/lib/org-context", () => ({
  ACTIVE_ORG_COOKIE: "cf_active_org",
  getUserOrgMemberships: (...args: unknown[]) => getUserOrgMemberships(...args),
}));

const getCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: getCookie }),
}));

const ALLOWED_ACCESS = { allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false };
const assertOrganizationAccess = vi.fn().mockResolvedValue(ALLOWED_ACCESS);
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: (...args: unknown[]) => assertOrganizationAccess(...args),
  SubscriptionRequiredError: class SubscriptionRequiredError extends Error {
    status = 402;
    code = "ORGANIZATION_SUBSCRIPTION_REQUIRED";
    constructor(readonly reason: string, message: string) {
      super(message);
    }
  },
}));

import { getMemberWebSession, requireMemberWebSession } from "@/lib/member-web-session";
import { SubscriptionRequiredError } from "@/lib/subscription-gate";

const memberOrgA = {
  organizationId: "org-a",
  organizationName: "Org A",
  organizationLogoUrl: null,
  role: "MEMBER",
  memberId: "member-a",
  memberStatus: "active",
};
const memberOrgB = {
  organizationId: "org-b",
  organizationName: "Org B",
  organizationLogoUrl: null,
  role: "MEMBER",
  memberId: "member-b",
  memberStatus: "active",
};
const staffOrgC = {
  organizationId: "org-c",
  organizationName: "Org C",
  organizationLogoUrl: null,
  role: "ORG_ADMIN",
  memberId: null,
  memberStatus: null,
};

describe("getMemberWebSession", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    getUserOrgMemberships.mockReset();
    getCookie.mockReset();
    getCookie.mockReturnValue(undefined);
  });

  it("returns null when there's no authenticated user", async () => {
    getServerSession.mockResolvedValueOnce(null);

    const result = await getMemberWebSession();

    expect(result).toBeNull();
    expect(getUserOrgMemberships).not.toHaveBeenCalled();
  });

  it("returns null when the user has no MEMBER-role memberships", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([staffOrgC]);

    const result = await getMemberWebSession();

    expect(result).toBeNull();
  });

  it("excludes non-MEMBER-role orgs even when the user has both", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA, staffOrgC]);

    const result = await getMemberWebSession();

    expect(result?.organizationId).toBe("org-a");
    expect(result?.organizations).toEqual([
      { organizationId: "org-a", organizationName: "Org A", organizationLogoUrl: null },
    ]);
  });

  it("prefers the unified ACTIVE_ORG_COOKIE over the legacy MEMBER_ORG_COOKIE", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA, memberOrgB]);
    getCookie.mockImplementation((name: string) => {
      if (name === "cf_active_org") return { value: "org-b" };
      if (name === "cf_member_org") return { value: "org-a" };
      return undefined;
    });

    const result = await getMemberWebSession();

    expect(result?.organizationId).toBe("org-b");
  });

  it("falls back to the legacy MEMBER_ORG_COOKIE when the unified cookie is unset", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA, memberOrgB]);
    getCookie.mockImplementation((name: string) => {
      if (name === "cf_member_org") return { value: "org-b" };
      return undefined;
    });

    const result = await getMemberWebSession();

    expect(result?.organizationId).toBe("org-b");
  });

  it("a valid requestedOrgId wins over either cookie", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA, memberOrgB]);
    getCookie.mockImplementation((name: string) => (name === "cf_active_org" ? { value: "org-a" } : undefined));

    const result = await getMemberWebSession("org-b");

    expect(result?.organizationId).toBe("org-b");
  });

  it("returns null if the resolved org has no OrgMember record", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([{ ...memberOrgA, memberId: null }]);

    const result = await getMemberWebSession();

    expect(result).toBeNull();
  });
});

describe("requireMemberWebSession", () => {
  beforeEach(() => {
    getServerSession.mockReset();
    getUserOrgMemberships.mockReset();
    getCookie.mockReset();
    getCookie.mockReturnValue(undefined);
    assertOrganizationAccess.mockReset();
    assertOrganizationAccess.mockResolvedValue(ALLOWED_ACCESS);
  });

  it("throws ForbiddenError when the caller isn't a member of the requested org", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA]);

    await expect(requireMemberWebSession("org-not-a-member-of")).rejects.toThrow();
    expect(assertOrganizationAccess).not.toHaveBeenCalled();
  });

  it("resolves for a valid membership", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA]);

    const result = await requireMemberWebSession("org-a");

    expect(result.organizationId).toBe("org-a");
    expect(assertOrganizationAccess).toHaveBeenCalledWith("org-a");
  });

  it("E2E-1 finding: checks tenant membership BEFORE billing — a caller who isn't a member never reaches the billing check, even for a billing-inactive org", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA]);
    assertOrganizationAccess.mockRejectedValueOnce(new Error("should never be called"));

    await expect(requireMemberWebSession("org-not-a-member-of")).rejects.toThrow("No active member session");
    expect(assertOrganizationAccess).not.toHaveBeenCalled();
  });

  it("E2E-1 finding: propagates SubscriptionRequiredError (402) for a real member of a billing-inactive org — this is the chokepoint for every giving/* and member-portal/* API route", async () => {
    getServerSession.mockResolvedValueOnce({ userId: "user-1" });
    getUserOrgMemberships.mockResolvedValueOnce([memberOrgA]);
    assertOrganizationAccess.mockRejectedValueOnce(
      new SubscriptionRequiredError("TRIAL_EXPIRED", "Your organization's Unestra trial has ended.")
    );

    await expect(requireMemberWebSession("org-a")).rejects.toThrow(SubscriptionRequiredError);
  });
});
