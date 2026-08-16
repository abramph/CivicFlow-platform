import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
const updateUser = vi.fn().mockResolvedValue({ id: "user-1" });
const findManyOrganizationMembership = vi.fn();
const countOrganizationMembership = vi.fn();
const deleteManyOrganizationMembership = vi.fn().mockResolvedValue({ count: 0 });
const deleteManyMfaChallengeToken = vi.fn().mockResolvedValue({ count: 0 });
const deleteManyAccountVerificationToken = vi.fn().mockResolvedValue({ count: 0 });
const deleteManyMobileDeviceToken = vi.fn().mockResolvedValue({ count: 0 });
const deleteManySavedFilter = vi.fn().mockResolvedValue({ count: 0 });
const deleteManyPlatformAccess = vi.fn().mockResolvedValue({ count: 0 });
const updateManyOrgMember = vi.fn().mockResolvedValue({ count: 0 });
const updateManyPtaHouseholdAdult = vi.fn().mockResolvedValue({ count: 0 });

const txClient = {
  organizationMembership: { deleteMany: (...a: unknown[]) => deleteManyOrganizationMembership(...a) },
  mfaChallengeToken: { deleteMany: (...a: unknown[]) => deleteManyMfaChallengeToken(...a) },
  accountVerificationToken: { deleteMany: (...a: unknown[]) => deleteManyAccountVerificationToken(...a) },
  mobileDeviceToken: { deleteMany: (...a: unknown[]) => deleteManyMobileDeviceToken(...a) },
  savedFilter: { deleteMany: (...a: unknown[]) => deleteManySavedFilter(...a) },
  platformAccess: { deleteMany: (...a: unknown[]) => deleteManyPlatformAccess(...a) },
  orgMember: { updateMany: (...a: unknown[]) => updateManyOrgMember(...a) },
  ptaHouseholdAdult: { updateMany: (...a: unknown[]) => updateManyPtaHouseholdAdult(...a) },
  user: { update: (...a: unknown[]) => updateUser(...a) },
};
const transaction = vi.fn((fn: (tx: typeof txClient) => unknown) => fn(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    organizationMembership: {
      findMany: (...args: unknown[]) => findManyOrganizationMembership(...args),
      count: (...args: unknown[]) => countOrganizationMembership(...args),
    },
    $transaction: (...args: Parameters<typeof transaction>) => transaction(...args),
  },
}));

import { deleteUserAccount, findSoleOwnerOrganizations, AccountDeletionError } from "@/lib/account-deletion";

function activeUser(overrides: Partial<{ id: string; deletedAt: Date | null }> = {}) {
  return { id: "user-1", deletedAt: null, ...overrides };
}

describe("findSoleOwnerOrganizations", () => {
  beforeEach(() => {
    findManyOrganizationMembership.mockReset();
    countOrganizationMembership.mockReset();
  });

  it("returns empty when the user owns no organizations", async () => {
    findManyOrganizationMembership.mockResolvedValueOnce([]);
    const result = await findSoleOwnerOrganizations("user-1");
    expect(result).toEqual([]);
    expect(countOrganizationMembership).not.toHaveBeenCalled();
  });

  it("returns empty when another active ORG_OWNER exists for every owned org (multi-org user handled safely)", async () => {
    findManyOrganizationMembership.mockResolvedValueOnce([
      { organizationId: "org-a", organization: { name: "Org A" } },
      { organizationId: "org-b", organization: { name: "Org B" } },
    ]);
    countOrganizationMembership.mockResolvedValueOnce(1); // org-a has another owner
    countOrganizationMembership.mockResolvedValueOnce(2); // org-b has other owners
    const result = await findSoleOwnerOrganizations("user-1");
    expect(result).toEqual([]);
  });

  it("blocks exactly the organizations where the user is the only active ORG_OWNER, scoped per org", async () => {
    findManyOrganizationMembership.mockResolvedValueOnce([
      { organizationId: "org-a", organization: { name: "Org A" } },
      { organizationId: "org-b", organization: { name: "Org B" } },
    ]);
    countOrganizationMembership.mockResolvedValueOnce(0); // org-a: sole owner
    countOrganizationMembership.mockResolvedValueOnce(1); // org-b: has a co-owner
    const result = await findSoleOwnerOrganizations("user-1");
    expect(result).toEqual([{ id: "org-a", name: "Org A" }]);

    // Tenant isolation: each org's owner count is scoped to that organizationId.
    expect(countOrganizationMembership).toHaveBeenNthCalledWith(1, {
      where: { organizationId: "org-a", role: "ORG_OWNER", status: "active", userId: { not: "user-1" } },
    });
    expect(countOrganizationMembership).toHaveBeenNthCalledWith(2, {
      where: { organizationId: "org-b", role: "ORG_OWNER", status: "active", userId: { not: "user-1" } },
    });
  });
});

describe("deleteUserAccount", () => {
  beforeEach(() => {
    findUniqueUser.mockReset();
    findManyOrganizationMembership.mockReset();
    countOrganizationMembership.mockReset();
    transaction.mockClear();
    transaction.mockImplementation((fn: (tx: typeof txClient) => unknown) => fn(txClient));
    updateUser.mockClear();
    deleteManyOrganizationMembership.mockClear();
    updateManyOrgMember.mockClear();
    updateManyPtaHouseholdAdult.mockClear();
    findManyOrganizationMembership.mockResolvedValue([]);
  });

  it("anonymizes a normal member's account and bumps mobileTokenVersion (session invalidation)", async () => {
    findUniqueUser.mockResolvedValueOnce(activeUser());

    const result = await deleteUserAccount({ userId: "user-1" });

    expect(result).toBe("DELETED");
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          mobileTokenVersion: { increment: 1 },
          deletedAt: expect.any(Date),
          passwordHash: expect.stringContaining("deleted:"),
        }),
      })
    );
  });

  it("never deletes the User row itself -- prisma.user.delete is never invoked", async () => {
    findUniqueUser.mockResolvedValueOnce(activeUser());
    await deleteUserAccount({ userId: "user-1" });
    expect(txClient.user).not.toHaveProperty("delete");
  });

  it("unlinks org-roster rows via SetNull instead of deleting the organization or its records", async () => {
    findUniqueUser.mockResolvedValueOnce(activeUser());
    await deleteUserAccount({ userId: "user-1" });

    expect(updateManyOrgMember).toHaveBeenCalledWith({ where: { userId: "user-1" }, data: { userId: null } });
    expect(updateManyPtaHouseholdAdult).toHaveBeenCalledWith({ where: { userId: "user-1" }, data: { userId: null } });
    // Only the user's own membership rows are removed -- never an org, and
    // never any financial/case/audit record (this mock has no delete method
    // for those models at all, so any attempt would throw).
    expect(deleteManyOrganizationMembership).toHaveBeenCalledWith({ where: { userId: "user-1" } });
  });

  it("blocks deletion when the user is the sole ORG_OWNER, without mutating anything", async () => {
    findUniqueUser.mockResolvedValueOnce(activeUser());
    findManyOrganizationMembership.mockResolvedValueOnce([{ organizationId: "org-a", organization: { name: "Org A" } }]);
    countOrganizationMembership.mockResolvedValueOnce(0);

    const result = deleteUserAccount({ userId: "user-1" });
    await expect(result).rejects.toBeInstanceOf(AccountDeletionError);
    await expect(result).rejects.toMatchObject({
      code: "SOLE_ORG_OWNER",
      blockedByOrganizations: [{ id: "org-a", name: "Org A" }],
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("is idempotent: a second deletion request on an already-deleted user is a safe no-op", async () => {
    findUniqueUser.mockResolvedValueOnce(activeUser({ deletedAt: new Date("2026-08-01") }));
    const result = await deleteUserAccount({ userId: "user-1" });
    expect(result).toBe("ALREADY_DELETED");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("is idempotent when the user row can't be found at all", async () => {
    findUniqueUser.mockResolvedValueOnce(null);
    const result = await deleteUserAccount({ userId: "does-not-exist" });
    expect(result).toBe("ALREADY_DELETED");
    expect(transaction).not.toHaveBeenCalled();
  });
});
