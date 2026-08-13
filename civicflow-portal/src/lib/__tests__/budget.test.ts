import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueSettings = vi.fn();
const findManyLines = vi.fn();
const groupByExpenditures = vi.fn();
const createLine = vi.fn();
const findFirstLine = vi.fn();
const updateLine = vi.fn();
const findFirstCategory = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueSettings(...a) },
    budgetLine: {
      findMany: (...a: unknown[]) => findManyLines(...a),
      create: (...a: unknown[]) => createLine(...a),
      findFirst: (...a: unknown[]) => findFirstLine(...a),
      update: (...a: unknown[]) => updateLine(...a),
    },
    expenditure: { groupBy: (...a: unknown[]) => groupByExpenditures(...a) },
    category: { findFirst: (...a: unknown[]) => findFirstCategory(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { createBudgetLine, fiscalYearWindow, getBudgetWithActuals } from "@/lib/budget";

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueSettings.mockResolvedValue({ fiscalYearStart: 7 });
});

describe("fiscalYearWindow", () => {
  it("school-year labels span fiscalYearStart to fiscalYearStart next year", () => {
    const window = fiscalYearWindow("2026-2027", 7);
    expect(window?.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(window?.end.toISOString()).toBe("2027-07-01T00:00:00.000Z");
  });

  it("single-year labels and unparseable labels", () => {
    expect(fiscalYearWindow("2026", 1)?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(fiscalYearWindow("FY Twenty-Six", 1)).toBeNull();
  });
});

describe("getBudgetWithActuals", () => {
  it("computes actuals from non-void expenditures in the window and variance per line", async () => {
    findManyLines.mockResolvedValueOnce([
      { id: "l1", name: "Events", fiscalYear: "2026-2027", categoryId: "cat-1", plannedAmount: 1000, notes: null, sortOrder: 0, isActive: true, category: { name: "Events" } },
      { id: "l2", name: "Uncategorized", fiscalYear: "2026-2027", categoryId: null, plannedAmount: 200, notes: null, sortOrder: 1, isActive: true, category: null },
    ]);
    groupByExpenditures.mockResolvedValueOnce([{ categoryId: "cat-1", _sum: { amount: 350.5 } }]);

    const budget = await getBudgetWithActuals("org-1", "2026-2027");

    const where = groupByExpenditures.mock.calls[0][0].where;
    expect(where.voidedAt).toBeNull();
    expect(where.date.gte.toISOString()).toBe("2026-07-01T00:00:00.000Z");

    expect(budget.lines[0]).toMatchObject({ plannedAmount: 1000, actualAmount: 350.5, variance: 649.5 });
    expect(budget.lines[1]).toMatchObject({ plannedAmount: 200, actualAmount: 0, variance: 200 });
    expect(budget.totals).toEqual({ planned: 1200, actual: 350.5, variance: 849.5 });
  });
});

describe("createBudgetLine", () => {
  it("duplicate (org, year, name) maps to a 409", async () => {
    createLine.mockRejectedValueOnce({ code: "P2002" });
    await expect(
      createBudgetLine({ organizationId: "org-1", fiscalYear: "2026-2027", name: "Events", plannedAmount: 100, actorUserId: "u1" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("budget lines only link to this org's EXPENDITURE categories", async () => {
    findFirstCategory.mockResolvedValueOnce(null);
    await expect(
      createBudgetLine({ organizationId: "org-1", fiscalYear: "2026-2027", name: "Events", plannedAmount: 100, categoryId: "foreign", actorUserId: "u1" })
    ).rejects.toMatchObject({ status: 404 });
  });
});
