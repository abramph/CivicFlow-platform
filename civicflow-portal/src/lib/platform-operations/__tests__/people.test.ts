import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindMany = vi.fn();
const userCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => userFindMany(...args),
      count: (...args: unknown[]) => userCount(...args),
    },
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("findDuplicateLookingAccounts", () => {
  it("groups accounts whose emails match after lowercasing and trimming", async () => {
    userFindMany.mockResolvedValueOnce([
      { id: "u1", email: "Test@Example.com" },
      { id: "u2", email: " test@example.com " },
      { id: "u3", email: "unique@example.com" },
    ]);
    const { findDuplicateLookingAccounts } = await import("../people");
    const groups = await findDuplicateLookingAccounts();
    expect(groups).toEqual([{ normalizedEmail: "test@example.com", userIds: ["u1", "u2"] }]);
  });

  it("returns an empty array when every email is unique", async () => {
    userFindMany.mockResolvedValueOnce([
      { id: "u1", email: "a@example.com" },
      { id: "u2", email: "b@example.com" },
    ]);
    const { findDuplicateLookingAccounts } = await import("../people");
    expect(await findDuplicateLookingAccounts()).toEqual([]);
  });

  it("never returns more groups than the requested limit", async () => {
    const users = Array.from({ length: 10 }, (_, i) => [
      { id: `a${i}`, email: `dup${i}@example.com` },
      { id: `b${i}`, email: `dup${i}@example.com` },
    ]).flat();
    userFindMany.mockResolvedValueOnce(users);
    const { findDuplicateLookingAccounts } = await import("../people");
    const groups = await findDuplicateLookingAccounts(3);
    expect(groups.length).toBe(3);
  });
});

describe("listPeople — safe field selection", () => {
  it("never selects passwordHash, mfaSecret, or backup codes from the User model", async () => {
    userCount.mockResolvedValueOnce(0);
    userFindMany.mockResolvedValueOnce([]);
    const { listPeople } = await import("../people");
    await listPeople({}, { page: 1, pageSize: 25 });

    const selectArg = (userFindMany.mock.calls[0]?.[0] as { select?: Record<string, unknown> })?.select;
    expect(selectArg).toBeDefined();
    expect(selectArg).not.toHaveProperty("passwordHash");
    expect(selectArg).not.toHaveProperty("mfaSecret");
    expect(selectArg).not.toHaveProperty("mfaBackupCodes");
  });

  it("always returns lastSignInAt as null — no fabricated last-login data", async () => {
    userCount.mockResolvedValueOnce(1);
    userFindMany.mockResolvedValueOnce([
      {
        id: "u1",
        email: "a@example.com",
        displayName: null,
        createdAt: new Date(),
        emailVerified: true,
        mfaEnabled: false,
        memberships: [],
        platformAccess: [],
      },
    ]);
    const { listPeople } = await import("../people");
    const result = await listPeople({}, { page: 1, pageSize: 25 });
    expect(result.items[0].lastSignInAt).toBeNull();
  });
});
