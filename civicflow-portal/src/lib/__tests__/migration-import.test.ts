import { beforeEach, describe, expect, it, vi } from "vitest";

const orgMemberFindFirst = vi.fn();
const orgMemberCreate = vi.fn();
const categoryFindFirst = vi.fn();
const orgSettingsUpsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => orgMemberFindFirst(...args),
      create: (...args: unknown[]) => orgMemberCreate(...args),
    },
    category: {
      findFirst: (...args: unknown[]) => categoryFindFirst(...args),
    },
    orgSettings: {
      upsert: (...args: unknown[]) => orgSettingsUpsert(...args),
    },
  },
}));

const checkMemberLimit = vi.fn();
vi.mock("@/lib/plan-gate", () => ({
  checkMemberLimit: (...args: unknown[]) => checkMemberLimit(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  orgMemberFindFirst.mockResolvedValue(null); // no existing match by default — every desktop member is "new"
  orgMemberCreate.mockImplementation(async ({ data }: { data: { firstName: string } }) => ({
    id: `created-${data.firstName}`,
  }));
  orgSettingsUpsert.mockResolvedValue({});
});

function desktopMembers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    first_name: `First${i}`,
    last_name: `Last${i}`,
    email: `desktop-member-${i}@example.com`,
  }));
}

describe("runMigrationImport — member-limit enforcement", () => {
  it("imports every desktop member when well under the limit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 5, limit: 500 });
    const { runMigrationImport } = await import("../migration-import");
    const counts = await runMigrationImport("org-1", { members: desktopMembers(3) });

    expect(counts.members).toBe(3);
    expect(counts.membersSkippedDueToLimit).toBe(0);
    expect(orgMemberCreate).toHaveBeenCalledTimes(3);
  });

  it("stops creating new members once the limit is reached, counting the rest as skipped rather than failing the whole import", async () => {
    // 498 existing, limit 500 — only 2 more can be created out of 5 desktop rows.
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 498, limit: 500 });
    const { runMigrationImport } = await import("../migration-import");
    const counts = await runMigrationImport("org-1", { members: desktopMembers(5) });

    expect(counts.members).toBe(2);
    expect(counts.membersSkippedDueToLimit).toBe(3);
    expect(orgMemberCreate).toHaveBeenCalledTimes(2);
  });

  it("imports zero new members and skips all of them when already at the limit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 500, limit: 500 });
    const { runMigrationImport } = await import("../migration-import");
    const counts = await runMigrationImport("org-1", { members: desktopMembers(4) });

    expect(counts.members).toBe(0);
    expect(counts.membersSkippedDueToLimit).toBe(4);
    expect(orgMemberCreate).not.toHaveBeenCalled();
  });

  it("matching an existing member by email is a no-op against the limit (re-import safety)", async () => {
    orgMemberFindFirst.mockResolvedValue({ id: "existing-member-id" });
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 500, limit: 500 });
    const { runMigrationImport } = await import("../migration-import");
    const counts = await runMigrationImport("org-1", { members: desktopMembers(3) });

    // Every row matches an existing member (already imported previously) —
    // a re-import at the limit still succeeds because nothing new is created.
    expect(counts.members).toBe(0);
    expect(counts.membersSkippedDueToLimit).toBe(0);
    expect(orgMemberCreate).not.toHaveBeenCalled();
  });

  it("handles an empty/absent members array without calling checkMemberLimit unnecessarily failing", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 0, limit: 50 });
    const { runMigrationImport } = await import("../migration-import");
    const counts = await runMigrationImport("org-1", {});
    expect(counts.members).toBe(0);
    expect(counts.membersSkippedDueToLimit).toBe(0);
  });
});
