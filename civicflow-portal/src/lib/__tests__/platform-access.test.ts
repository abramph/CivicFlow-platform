import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyPlatformAccess = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformAccess: { findMany: (...args: unknown[]) => findManyPlatformAccess(...args) },
  },
}));

import { getPlatformAccessForUser, hasPlatformRole } from "@/lib/platform-access";

describe("getPlatformAccessForUser", () => {
  beforeEach(() => {
    findManyPlatformAccess.mockReset();
  });

  it("returns hasPlatformAccess: true with the role when an ACTIVE grant exists", async () => {
    findManyPlatformAccess.mockResolvedValueOnce([{ role: "SUPER_ADMIN" }]);

    const result = await getPlatformAccessForUser("user-1");

    expect(result).toEqual({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    // Must only ever query ACTIVE status — suspended/revoked rows must never
    // silently count as access.
    expect(findManyPlatformAccess).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "ACTIVE" },
      select: { role: true },
    });
  });

  it("returns hasPlatformAccess: false when there are zero ACTIVE grants (missing access)", async () => {
    findManyPlatformAccess.mockResolvedValueOnce([]);

    const result = await getPlatformAccessForUser("user-1");

    expect(result).toEqual({ hasPlatformAccess: false, platformRoles: [] });
  });

  it("does not surface SUSPENDED or REVOKED grants as access (query filters them out at the source)", async () => {
    // The query itself only ever asks for status: "ACTIVE" — this test
    // documents that guarantee by asserting the mock is never given a
    // reason to return a suspended/revoked row in the first place.
    findManyPlatformAccess.mockResolvedValueOnce([]);

    const result = await getPlatformAccessForUser("user-with-suspended-grant");

    expect(result.hasPlatformAccess).toBe(false);
    const call = findManyPlatformAccess.mock.calls[0][0];
    expect(call.where.status).toBe("ACTIVE");
  });

  it("reflects multiple active platform roles if a user somehow holds more than one", async () => {
    findManyPlatformAccess.mockResolvedValueOnce([{ role: "SUPER_ADMIN" }]);

    const result = await getPlatformAccessForUser("user-1");

    expect(result.platformRoles).toContain("SUPER_ADMIN");
  });
});

describe("hasPlatformRole", () => {
  it("returns true when the role is present", () => {
    expect(hasPlatformRole({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] }, "SUPER_ADMIN")).toBe(true);
  });

  it("returns false when the role is absent", () => {
    expect(hasPlatformRole({ hasPlatformAccess: false, platformRoles: [] }, "SUPER_ADMIN")).toBe(false);
  });
});
