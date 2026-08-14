import { Prisma, type GivingModuleStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-A — Funds: "where is the money designated?" (§4). Funds are
 * NEVER hard-deleted; CLOSED/ARCHIVED stop new use while every historical
 * contribution keeps its designation (Restrict FKs guarantee it at the DB).
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

const FUND_STATUS_TRANSITIONS: Record<GivingModuleStatus, GivingModuleStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["INACTIVE", "CLOSED"],
  INACTIVE: ["ACTIVE", "CLOSED", "ARCHIVED"],
  CLOSED: ["ARCHIVED", "ACTIVE"],
  ARCHIVED: [],
};

export async function listFunds(organizationId: string, options: { includeNonActive?: boolean } = {}) {
  await ensureContributionsEnabled(organizationId);
  return prisma.fund.findMany({
    where: { organizationId, ...(options.includeNonActive ? {} : { status: "ACTIVE" }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { programs: true, contributions: true } } },
  });
}

export interface UpsertFundInput extends ActorInput {
  organizationId: string;
  fundId?: string;
  name?: string;
  description?: string | null;
  shortCode?: string | null;
  isPublic?: boolean;
  allowOneTime?: boolean;
  allowRecurring?: boolean;
  allowPledges?: boolean;
  suggestedAmounts?: number[];
  minimumAmount?: number | null;
  maximumAmount?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  sortOrder?: number;
  accountingCode?: string | null;
}

function validateAmounts(input: Pick<UpsertFundInput, "suggestedAmounts" | "minimumAmount" | "maximumAmount">) {
  for (const amount of input.suggestedAmounts ?? []) {
    if (!Number.isFinite(amount) || amount <= 0) throw new FinanceError("Suggested amounts must be positive.");
  }
  if (input.minimumAmount !== undefined && input.minimumAmount !== null && input.minimumAmount < 0) {
    throw new FinanceError("Minimum amount cannot be negative.");
  }
  if (
    input.minimumAmount !== undefined &&
    input.minimumAmount !== null &&
    input.maximumAmount !== undefined &&
    input.maximumAmount !== null &&
    input.maximumAmount < input.minimumAmount
  ) {
    throw new FinanceError("Maximum amount cannot be below the minimum.");
  }
}

function decimals(values: number[] | undefined) {
  return (values ?? []).map((value) => new Prisma.Decimal(value.toFixed(2)));
}

export async function createFund(input: UpsertFundInput) {
  await ensureContributionsEnabled(input.organizationId);
  const name = input.name?.trim();
  if (!name) throw new FinanceError("Fund name is required.");
  validateAmounts(input);

  try {
    const fund = await prisma.fund.create({
      data: {
        organizationId: input.organizationId,
        name,
        description: input.description?.trim() || null,
        shortCode: input.shortCode?.trim() || null,
        isPublic: input.isPublic ?? false,
        allowOneTime: input.allowOneTime ?? true,
        allowRecurring: input.allowRecurring ?? true,
        allowPledges: input.allowPledges ?? false,
        suggestedAmounts: decimals(input.suggestedAmounts),
        minimumAmount: input.minimumAmount != null ? new Prisma.Decimal(input.minimumAmount.toFixed(2)) : null,
        maximumAmount: input.maximumAmount != null ? new Prisma.Decimal(input.maximumAmount.toFixed(2)) : null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        sortOrder: input.sortOrder ?? 0,
        accountingCode: input.accountingCode?.trim() || null,
      },
    });
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "giving.fund_created",
      entityType: "fund",
      entityId: fund.id,
      metadata: { name },
    });
    return fund;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new FinanceError(`A fund named "${name}" already exists.`, 409);
    }
    throw error;
  }
}

export async function updateFund(input: UpsertFundInput & { fundId: string; status?: GivingModuleStatus }) {
  await ensureContributionsEnabled(input.organizationId);
  const existing = await prisma.fund.findFirst({ where: { id: input.fundId, organizationId: input.organizationId } });
  if (!existing) throw new FinanceError("Fund not found.", 404);
  validateAmounts(input);

  if (input.status !== undefined && input.status !== existing.status) {
    if (!FUND_STATUS_TRANSITIONS[existing.status].includes(input.status)) {
      throw new FinanceError(`A ${existing.status.toLowerCase()} fund cannot move to ${input.status.toLowerCase()}.`, 409);
    }
    // §98 fund closure: never silently redirect giving — CORE-GIVE-C adds the
    // schedule-migration workflow; in A, closing simply stops new use.
  }

  const fund = await prisma.fund.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      ...(input.shortCode !== undefined ? { shortCode: input.shortCode?.trim() || null } : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      ...(input.allowOneTime !== undefined ? { allowOneTime: input.allowOneTime } : {}),
      ...(input.allowRecurring !== undefined ? { allowRecurring: input.allowRecurring } : {}),
      ...(input.allowPledges !== undefined ? { allowPledges: input.allowPledges } : {}),
      ...(input.suggestedAmounts !== undefined ? { suggestedAmounts: decimals(input.suggestedAmounts) } : {}),
      ...(input.minimumAmount !== undefined
        ? { minimumAmount: input.minimumAmount != null ? new Prisma.Decimal(input.minimumAmount.toFixed(2)) : null }
        : {}),
      ...(input.maximumAmount !== undefined
        ? { maximumAmount: input.maximumAmount != null ? new Prisma.Decimal(input.maximumAmount.toFixed(2)) : null }
        : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.accountingCode !== undefined ? { accountingCode: input.accountingCode?.trim() || null } : {}),
      ...(input.status !== undefined
        ? { status: input.status, ...(input.status === "ARCHIVED" ? { archivedAt: new Date() } : {}) }
        : {}),
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: input.status !== undefined && input.status !== existing.status ? "giving.fund_status_changed" : "giving.fund_updated",
    entityType: "fund",
    entityId: fund.id,
    metadata: { name: fund.name, before: existing.status, after: fund.status },
  });
  return fund;
}
