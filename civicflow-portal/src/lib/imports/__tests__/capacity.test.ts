import { beforeEach, describe, expect, it, vi } from "vitest";

const checkMemberLimit = vi.fn();
vi.mock("@/lib/plan-gate", () => ({ checkMemberLimit: (...args: unknown[]) => checkMemberLimit(...args) }));

const countImportRow = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    importRow: { count: (...args: unknown[]) => countImportRow(...args) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importKindConsumesCapacity", () => {
  it("only COMMUNITY_MEMBERS consumes capacity in PR A", async () => {
    const { importKindConsumesCapacity } = await import("../capacity");
    expect(importKindConsumesCapacity("COMMUNITY_MEMBERS")).toBe(true);
    expect(importKindConsumesCapacity("PTA_HOUSEHOLDS")).toBe(false);
    expect(importKindConsumesCapacity("HOA_PROPERTIES")).toBe(false);
  });
});

describe("checkImportCapacity", () => {
  it("delegates to checkMemberLimit() for COMMUNITY_MEMBERS, reusing it rather than reimplementing", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 460, limit: 500 });
    const { checkImportCapacity } = await import("../capacity");
    const result = await checkImportCapacity("org-a", "COMMUNITY_MEMBERS");
    expect(checkMemberLimit).toHaveBeenCalledWith("org-a");
    expect(result).toEqual({ allowed: true, used: 460, limit: 500, remainingForThisBatch: 40 });
  });

  it("reports zero remaining once at the limit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 500, limit: 500 });
    const { checkImportCapacity } = await import("../capacity");
    const result = await checkImportCapacity("org-a", "COMMUNITY_MEMBERS");
    expect(result.allowed).toBe(false);
    expect(result.remainingForThisBatch).toBe(0);
  });

  it("skips the member-limit check entirely for kinds that don't consume capacity", async () => {
    const { checkImportCapacity } = await import("../capacity");
    const result = await checkImportCapacity("org-a", "PTA_HOUSEHOLDS");
    expect(checkMemberLimit).not.toHaveBeenCalled();
    expect(result.allowed).toBe(true);
    expect(result.remainingForThisBatch).toBe(Infinity);
  });

  it("never reports a negative remaining count when usage already exceeds the limit", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 510, limit: 500 });
    const { checkImportCapacity } = await import("../capacity");
    const result = await checkImportCapacity("org-a", "COMMUNITY_MEMBERS");
    expect(result.remainingForThisBatch).toBe(0);
  });
});

describe("buildPlanLimitSnapshot", () => {
  it("captures allowed/used/pending at the moment capacity is exhausted", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: false, current: 500, limit: 500 });
    countImportRow.mockResolvedValueOnce(230);
    const { buildPlanLimitSnapshot } = await import("../capacity");
    const snapshot = await buildPlanLimitSnapshot("batch-1", "org-a", "COMMUNITY_MEMBERS");
    expect(snapshot).toEqual({ allowed: 500, used: 500, pendingAfterUpgrade: 230 });
    expect(countImportRow).toHaveBeenCalledWith({
      where: { batchId: "batch-1", status: { in: ["BLOCKED_PLAN_LIMIT", "NEW", "PENDING"] } },
    });
  });

  it("reports -1 for allowed when the plan has no member limit at all", async () => {
    checkMemberLimit.mockResolvedValueOnce({ allowed: true, current: 12, limit: Infinity });
    countImportRow.mockResolvedValueOnce(0);
    const { buildPlanLimitSnapshot } = await import("../capacity");
    const snapshot = await buildPlanLimitSnapshot("batch-1", "org-a", "COMMUNITY_MEMBERS");
    expect(snapshot.allowed).toBe(-1);
  });
});
