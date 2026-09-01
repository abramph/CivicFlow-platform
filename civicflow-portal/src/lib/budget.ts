import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance-errors";

/**
 * PTA Vertical 2.0, PR PTA-H — Budget-vs-actual (core; docs/pta-vertical-2.md
 * PTA-H). Actuals are never stored: they are summed live from non-void
 * Expenditures in the line's category inside the fiscal-year window, so
 * variance can never drift out of sync with the ledger.
 */

/** "2026-2027" → [fyStart of 2026, fyStart of 2027); "2026" → one year from
 * fyStart of 2026; anything else → null (actuals computed all-time).
 * fiscalYearStartMonth is 1-12 (OrgSettings.fiscalYearStart). */
export function fiscalYearWindow(label: string, fiscalYearStartMonth: number): { start: Date; end: Date } | null {
  const month = Math.min(12, Math.max(1, Math.trunc(fiscalYearStartMonth || 1)));
  const span = /^(\d{4})\s*[-–/]\s*(\d{4})$/.exec(label.trim());
  if (span) {
    const startYear = Number(span[1]);
    return { start: new Date(Date.UTC(startYear, month - 1, 1)), end: new Date(Date.UTC(startYear + 1, month - 1, 1)) };
  }
  const single = /^(\d{4})$/.exec(label.trim());
  if (single) {
    const startYear = Number(single[1]);
    return { start: new Date(Date.UTC(startYear, month - 1, 1)), end: new Date(Date.UTC(startYear + 1, month - 1, 1)) };
  }
  return null;
}

export interface BudgetLineWithActual {
  id: string;
  name: string;
  fiscalYear: string;
  categoryId: string | null;
  categoryName: string | null;
  plannedAmount: number;
  actualAmount: number;
  variance: number;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
}

export async function getBudgetWithActuals(organizationId: string, fiscalYear: string): Promise<{
  fiscalYear: string;
  lines: BudgetLineWithActual[];
  totals: { planned: number; actual: number; variance: number };
}> {
  const settings = await prisma.orgSettings.findUnique({ where: { organizationId }, select: { fiscalYearStart: true } });
  const window = fiscalYearWindow(fiscalYear, settings?.fiscalYearStart ?? 1);

  const lines = await prisma.budgetLine.findMany({
    where: { organizationId, fiscalYear, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { category: { select: { name: true } } },
  });

  const categoryIds = lines.map((line) => line.categoryId).filter((id): id is string => id !== null);
  const sums = categoryIds.length
    ? await prisma.expenditure.groupBy({
        by: ["categoryId"],
        where: {
          organizationId,
          categoryId: { in: categoryIds },
          voidedAt: null,
          ...(window ? { date: { gte: window.start, lt: window.end } } : {}),
        },
        _sum: { amount: true },
      })
    : [];
  const actualByCategory = new Map(sums.map((row) => [row.categoryId, Number(row._sum.amount ?? 0)]));

  const withActuals: BudgetLineWithActual[] = lines.map((line) => {
    const planned = Number(line.plannedAmount);
    const actual = line.categoryId ? (actualByCategory.get(line.categoryId) ?? 0) : 0;
    return {
      id: line.id,
      name: line.name,
      fiscalYear: line.fiscalYear,
      categoryId: line.categoryId,
      categoryName: line.category?.name ?? null,
      plannedAmount: planned,
      actualAmount: actual,
      variance: planned - actual,
      notes: line.notes,
      sortOrder: line.sortOrder,
      isActive: line.isActive,
    };
  });

  const totals = withActuals.reduce(
    (accumulator, line) => ({
      planned: accumulator.planned + line.plannedAmount,
      actual: accumulator.actual + line.actualAmount,
      variance: accumulator.variance + line.variance,
    }),
    { planned: 0, actual: 0, variance: 0 }
  );

  return { fiscalYear, lines: withActuals, totals };
}

export interface UpsertBudgetLineInput {
  organizationId: string;
  lineId?: string;
  fiscalYear?: string;
  name?: string;
  categoryId?: string | null;
  plannedAmount?: number;
  notes?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  actorUserId: string;
  actorEmail?: string | null;
}

async function assertCategory(organizationId: string, categoryId: string) {
  const category = await prisma.category.findFirst({ where: { id: categoryId, organizationId, type: "EXPENDITURE" } });
  if (!category) throw new FinanceError("Category not found (budget lines link to expenditure categories).", 404);
}

export async function createBudgetLine(input: UpsertBudgetLineInput) {
  const name = input.name?.trim();
  const fiscalYear = input.fiscalYear?.trim();
  if (!name) throw new FinanceError("Budget line name is required.");
  if (!fiscalYear) throw new FinanceError("Fiscal year is required.");
  if (input.plannedAmount === undefined || !Number.isFinite(input.plannedAmount) || input.plannedAmount < 0) {
    throw new FinanceError("Planned amount must be zero or more.");
  }
  const plannedAmount = input.plannedAmount;
  if (input.categoryId) await assertCategory(input.organizationId, input.categoryId);

  try {
    return await prisma.$transaction(async (tx) => {
      const line = await tx.budgetLine.create({
        data: {
          organizationId: input.organizationId,
          fiscalYear,
          name,
          categoryId: input.categoryId ?? null,
          plannedAmount: new Prisma.Decimal(plannedAmount.toFixed(2)),
          notes: input.notes?.trim() || null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await createAuditEvent({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail ?? null,
        action: "budget.line_created",
        entityType: "budget_line",
        entityId: line.id,
        metadata: { fiscalYear, name, plannedAmount },
        tx,
      });
      return line;
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new FinanceError(`A budget line named "${name}" already exists for ${fiscalYear}.`, 409);
    }
    throw error;
  }
}

export async function updateBudgetLine(input: UpsertBudgetLineInput & { lineId: string }) {
  const existing = await prisma.budgetLine.findFirst({ where: { id: input.lineId, organizationId: input.organizationId } });
  if (!existing) throw new FinanceError("Budget line not found.", 404);
  if (input.plannedAmount !== undefined && (!Number.isFinite(input.plannedAmount) || input.plannedAmount < 0)) {
    throw new FinanceError("Planned amount must be zero or more.");
  }
  if (input.categoryId) await assertCategory(input.organizationId, input.categoryId);

  return prisma.$transaction(async (tx) => {
    const line = await tx.budgetLine.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.plannedAmount !== undefined ? { plannedAmount: new Prisma.Decimal(input.plannedAmount.toFixed(2)) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "budget.line_updated",
      entityType: "budget_line",
      entityId: line.id,
      metadata: { name: line.name },
      tx,
    });
    return line;
  });
}
