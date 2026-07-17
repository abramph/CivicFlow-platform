import { beforeEach, describe, expect, it, vi } from "vitest";

const orgMemberFindFirst = vi.fn();
const orgMemberCreate = vi.fn();
const orgMemberUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => orgMemberFindFirst(...args),
      create: (...args: unknown[]) => orgMemberCreate(...args),
      update: (...args: unknown[]) => orgMemberUpdate(...args),
    },
  },
}));

const checkMemberLimit = vi.fn();
vi.mock("@/lib/plan-gate", () => ({
  checkMemberLimit: (...args: unknown[]) => checkMemberLimit(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  orgMemberFindFirst.mockResolvedValue(null); // no existing match by default — every row is "new"
  orgMemberCreate.mockResolvedValue({ id: "new-member" });
});

function makeRows(count: number): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({
    firstName: `First${i}`,
    lastName: `Last${i}`,
    email: `member${i}@example.com`,
  }));
}

describe("importMembers — member-limit enforcement", () => {
  it("imports every row when the organization is well under its limit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 5, limit: 50 });
    const { importMembers } = await import("../member-import");
    const results = await importMembers(makeRows(3), {}, "org-1", false);

    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(orgMemberCreate).toHaveBeenCalledTimes(3);
  });

  it("stops creating new members once the limit is reached, reporting per-row errors for the overflow", async () => {
    // 48 existing, limit 50 — only 2 more can be created.
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 48, limit: 50 });
    const { importMembers } = await import("../member-import");
    const results = await importMembers(makeRows(5), {}, "org-1", false);

    const ok = results.filter((r) => r.status === "ok");
    const errors = results.filter((r) => r.status === "error");
    expect(ok).toHaveLength(2);
    expect(errors).toHaveLength(3);
    expect(errors[0].message).toMatch(/Member limit reached \(50\)/);
    expect(orgMemberCreate).toHaveBeenCalledTimes(2);
  });

  it("does not create any new member when already at the limit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 50, limit: 50 });
    const { importMembers } = await import("../member-import");
    const results = await importMembers(makeRows(3), {}, "org-1", false);

    expect(results.every((r) => r.status === "error")).toBe(true);
    expect(orgMemberCreate).not.toHaveBeenCalled();
  });

  it("updating an existing (email-matched) member never counts against the limit", async () => {
    orgMemberFindFirst.mockResolvedValue({ id: "existing-1", firstName: "Old", lastName: "Name" });
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 50, limit: 50 });
    const { importMembers } = await import("../member-import");
    const results = await importMembers(makeRows(3), {}, "org-1", false);

    // All 3 rows match an existing member by email — every row is an update,
    // not a new insert, so the already-at-limit org can still import them.
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(orgMemberUpdate).toHaveBeenCalledTimes(3);
    expect(orgMemberCreate).not.toHaveBeenCalled();
  });

  it("does not call checkMemberLimit at all in preview mode", async () => {
    const { importMembers } = await import("../member-import");
    await importMembers(makeRows(3), {}, "org-1", true);
    expect(checkMemberLimit).not.toHaveBeenCalled();
    expect(orgMemberCreate).not.toHaveBeenCalled();
  });

  it("rejects a row with both first and last name blank, independent of the limit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 0, limit: 50 });
    const { importMembers } = await import("../member-import");
    const results = await importMembers([{ firstName: "", lastName: "" }], {}, "org-1", false);
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/blank/);
  });
});
