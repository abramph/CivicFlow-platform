import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstMembership = vi.fn();
const findFirstOrgMember = vi.fn();
const findFirstHouseholdAdult = vi.fn();
const findUniqueUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: { findFirst: (...args: unknown[]) => findFirstMembership(...args) },
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    ptaHouseholdAdult: { findFirst: (...args: unknown[]) => findFirstHouseholdAdult(...args) },
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
  },
}));

// This suite tests org-tie/tenant-isolation resolution. assertOrganizationAccess
// is a named, resettable mock (not a fixed factory value) so the E2E-3
// bypass-ordering tests below can assert it was never reached when tenant
// isolation already rejected the request — the billing check must never be
// the FIRST gate a client-claimed organizationId passes through.
const assertOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: (...args: unknown[]) => assertOrganizationAccess(...args),
}));
const ALLOWED_ACCESS = { allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false } as const;

/**
 * `hasActiveOrgTie()` fans out to three queries in parallel — a MEMBER-role
 * membership, a PTA household link, and a staff-role membership — so a test
 * that wants "this user's only tie is X" must say so for all three.
 */
function orgTie({ member = null, household = null, staff = null }: { member?: unknown; household?: unknown; staff?: unknown }) {
  findFirstMembership.mockResolvedValueOnce(member).mockResolvedValueOnce(staff);
  findFirstHouseholdAdult.mockResolvedValueOnce(household);
}

import { requireMobileAuth, requireMobileMembership, signAccessToken } from "@/lib/mobile-auth";

function requestWithToken(token: string) {
  return new Request("https://portal.test/api/mobile/dues", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("mobile-auth: token round trip", () => {
  it("signs and verifies an access token for the same user", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com", mobileTokenVersion: 0 });
    const token = await signAccessToken("user-1", 0);
    const session = await requireMobileAuth(requestWithToken(token));
    expect(session).toEqual({ userId: "user-1", email: "member@example.com" });
  });

  it("rejects a request with no bearer token", async () => {
    await expect(requireMobileAuth(new Request("https://portal.test/api/mobile/dues"))).rejects.toThrow(
      /Missing bearer token/
    );
  });

  it("rejects a token whose user no longer exists", async () => {
    findUniqueUser.mockResolvedValueOnce(null);
    const token = await signAccessToken("deleted-user", 0);
    await expect(requireMobileAuth(requestWithToken(token))).rejects.toThrow(/no longer exists/);
  });
});

describe("mobile-auth: token revocation via mobileTokenVersion", () => {
  it("rejects an access token signed with a version older than the user's current one", async () => {
    // Token was issued at version 0 (e.g. before a password reset or logout bumped it to 1).
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com", mobileTokenVersion: 1 });
    const token = await signAccessToken("user-1", 0);
    await expect(requireMobileAuth(requestWithToken(token))).rejects.toThrow(/Invalid or expired access token/);
  });

  it("accepts an access token signed with the user's current version", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com", mobileTokenVersion: 3 });
    const token = await signAccessToken("user-1", 3);
    const session = await requireMobileAuth(requestWithToken(token));
    expect(session.userId).toBe("user-1");
  });
});

describe("mobile-auth: cross-organization tenant isolation", () => {
  beforeEach(() => {
    findFirstMembership.mockReset();
    findFirstOrgMember.mockReset();
    findFirstHouseholdAdult.mockReset();
    findUniqueUser.mockReset();
    assertOrganizationAccess.mockReset().mockResolvedValue(ALLOWED_ACCESS);
  });

  it("grants access when the caller has a MEMBER membership in the requested org", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com", mobileTokenVersion: 0 });
    orgTie({ member: { id: "membership-1", organizationId: "org-a", userId: "user-1", role: "MEMBER" } });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });

    const token = await signAccessToken("user-1", 0);
    const result = await requireMobileMembership(requestWithToken(token), "org-a");

    expect(result.organizationId).toBe("org-a");
    expect(result.memberId).toBe("member-1");
    // E2E-3: once tenant isolation confirms the caller's real tie to org-a,
    // the billing gate runs against that same verified org-a — never a
    // different, client-supplied value.
    expect(assertOrganizationAccess).toHaveBeenCalledWith("org-a");
  });

  it("denies access to an organization the caller does not belong to — even though they're authenticated", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com", mobileTokenVersion: 0 });
    // Caller only has a membership in org-a; they ask for org-b's data.
    orgTie({});

    const token = await signAccessToken("user-1", 0);
    await expect(requireMobileMembership(requestWithToken(token), "org-b")).rejects.toThrow(
      /No active membership for this organization/
    );
    expect(findFirstOrgMember).not.toHaveBeenCalled();
    // E2E-3: a client claiming an organizationId it has no real tie to is
    // rejected by tenant isolation BEFORE the billing gate ever runs — the
    // billing check can never be reached for a forged/arbitrary org claim,
    // only for an org the caller is genuinely a member of.
    expect(assertOrganizationAccess).not.toHaveBeenCalled();
  });

  it("denies access when a membership exists but has no linked OrgMember record", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "user-1", email: "member@example.com", mobileTokenVersion: 0 });
    orgTie({ member: { id: "membership-1", organizationId: "org-a", userId: "user-1", role: "MEMBER" } });
    findFirstOrgMember.mockResolvedValueOnce(null);

    const token = await signAccessToken("user-1", 0);
    await expect(requireMobileMembership(requestWithToken(token), "org-a")).rejects.toThrow(
      /No linked member record/
    );
  });
});

/**
 * Administrative role and constituent identity are separate concepts. A
 * staff/owner login that ALSO has an OrgMember (accept-invite.ts links the
 * member while deliberately preserving the staff role) is a legitimate
 * dues-paying member and must not be rejected by member-only operations —
 * while a staff/owner with NO OrgMember still must be.
 */
describe("mobile-auth: dual identity (staff/owner who is also a member)", () => {
  beforeEach(() => {
    findFirstMembership.mockReset();
    findFirstOrgMember.mockReset();
    findFirstHouseholdAdult.mockReset();
    findUniqueUser.mockReset();
    assertOrganizationAccess.mockReset().mockResolvedValue(ALLOWED_ACCESS);
  });

  it("grants member-only access to an ORG_OWNER who has a linked OrgMember", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "owner-1", email: "owner@example.com", mobileTokenVersion: 0 });
    orgTie({ staff: { id: "membership-owner", organizationId: "org-a", userId: "owner-1", role: "ORG_OWNER" } });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-owner" });

    const token = await signAccessToken("owner-1", 0);
    const result = await requireMobileMembership(requestWithToken(token), "org-a");

    expect(result.memberId).toBe("member-owner");
  });

  it("grants member-only access to a STAFF login who has a linked OrgMember", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "staff-1", email: "staff@example.com", mobileTokenVersion: 0 });
    orgTie({ staff: { id: "membership-staff", organizationId: "org-a", userId: "staff-1", role: "STAFF" } });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-staff" });

    const token = await signAccessToken("staff-1", 0);
    const result = await requireMobileMembership(requestWithToken(token), "org-a");

    expect(result.memberId).toBe("member-staff");
  });

  it("still denies member-only access to a staff/owner with NO linked OrgMember", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "owner-2", email: "owner2@example.com", mobileTokenVersion: 0 });
    orgTie({ staff: { id: "membership-owner", organizationId: "org-a", userId: "owner-2", role: "ORG_OWNER" } });
    findFirstOrgMember.mockResolvedValueOnce(null);

    const token = await signAccessToken("owner-2", 0);
    await expect(requireMobileMembership(requestWithToken(token), "org-a")).rejects.toThrow(
      /No linked member record/
    );
  });

  it("does not let a staff role in one org reach member data in another", async () => {
    findUniqueUser.mockResolvedValueOnce({ id: "owner-3", email: "owner3@example.com", mobileTokenVersion: 0 });
    // No tie of any kind to org-b, despite owning org-a.
    orgTie({});

    const token = await signAccessToken("owner-3", 0);
    await expect(requireMobileMembership(requestWithToken(token), "org-b")).rejects.toThrow(
      /No active membership for this organization/
    );
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });
});
