import { Prisma, type ContributionProgramType, type GivingModuleStatus, type ObligationNature } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-A — Contribution Programs: "what giving experience is offered?"
 * (§5). THE NON-NEGOTIABLE RULE lives here: obligationNature is explicit and
 * server-enforced — REQUIRED is legal ONLY for type DUES. Every other program
 * type is VOLUNTARY, and voluntary giving can never produce debt, arrears,
 * delinquency, or membership consequences anywhere downstream.
 */

interface ActorInput {
  actorUserId: string;
  actorEmail?: string | null;
}

export const ALLOWED_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "ANNUALLY"] as const;

/** The §5 rule, exported so tests and future PRs assert against one source. */
export function resolveObligationNature(type: ContributionProgramType, requested: ObligationNature | undefined): ObligationNature {
  if (type === "DUES") return requested ?? "REQUIRED";
  if (requested === "REQUIRED") {
    throw new FinanceError(
      "Only a dues program can carry a required obligation. Voluntary giving never creates debt — that distinction is not configurable.",
      422
    );
  }
  return "VOLUNTARY";
}

export async function listPrograms(organizationId: string, options: { includeNonActive?: boolean } = {}) {
  await ensureContributionsEnabled(organizationId);
  return prisma.contributionProgram.findMany({
    where: { organizationId, ...(options.includeNonActive ? {} : { status: "ACTIVE" }) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { fund: { select: { id: true, name: true, status: true } } },
  });
}

export interface UpsertProgramInput extends ActorInput {
  organizationId: string;
  programId?: string;
  fundId?: string;
  name?: string;
  description?: string | null;
  type?: ContributionProgramType;
  obligationNature?: ObligationNature;
  allowCustomAmount?: boolean;
  suggestedAmounts?: number[];
  defaultAmount?: number | null;
  allowedFrequencies?: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  visibility?: "MEMBERS" | "PUBLIC" | "HIDDEN";
  receiptLanguage?: string | null;
  status?: GivingModuleStatus;
  sortOrder?: number;
}

async function assertUsableFund(organizationId: string, fundId: string) {
  const fund = await prisma.fund.findFirst({ where: { id: fundId, organizationId } });
  if (!fund) throw new FinanceError("Fund not found.", 404);
  if (fund.status === "CLOSED" || fund.status === "ARCHIVED") {
    throw new FinanceError(`"${fund.name}" is ${fund.status.toLowerCase()} and cannot take new programs.`, 409);
  }
  return fund;
}

function validateFrequencies(frequencies: string[] | undefined) {
  for (const frequency of frequencies ?? []) {
    if (!ALLOWED_FREQUENCIES.includes(frequency as (typeof ALLOWED_FREQUENCIES)[number])) {
      throw new FinanceError(`Unknown frequency "${frequency}".`);
    }
  }
}

export async function createProgram(input: UpsertProgramInput) {
  await ensureContributionsEnabled(input.organizationId);
  const name = input.name?.trim();
  if (!name) throw new FinanceError("Program name is required.");
  if (!input.fundId) throw new FinanceError("Every program designates a fund.");
  await assertUsableFund(input.organizationId, input.fundId);
  validateFrequencies(input.allowedFrequencies);

  const type = input.type ?? "VOLUNTARY_CONTRIBUTION";
  const obligationNature = resolveObligationNature(type, input.obligationNature);

  try {
    const program = await prisma.contributionProgram.create({
      data: {
        organizationId: input.organizationId,
        fundId: input.fundId,
        name,
        description: input.description?.trim() || null,
        type,
        obligationNature,
        allowCustomAmount: input.allowCustomAmount ?? true,
        suggestedAmounts: (input.suggestedAmounts ?? []).map((value) => new Prisma.Decimal(value.toFixed(2))),
        defaultAmount: input.defaultAmount != null ? new Prisma.Decimal(input.defaultAmount.toFixed(2)) : null,
        allowedFrequencies: input.allowedFrequencies ?? [],
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        visibility: input.visibility ?? "MEMBERS",
        receiptLanguage: input.receiptLanguage?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail ?? null,
      action: "giving.program_created",
      entityType: "contribution_program",
      entityId: program.id,
      metadata: { name, type, obligationNature },
    });
    return program;
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new FinanceError(`A program named "${name}" already exists.`, 409);
    }
    throw error;
  }
}

export async function updateProgram(input: UpsertProgramInput & { programId: string }) {
  await ensureContributionsEnabled(input.organizationId);
  const existing = await prisma.contributionProgram.findFirst({
    where: { id: input.programId, organizationId: input.organizationId },
  });
  if (!existing) throw new FinanceError("Program not found.", 404);
  if (input.fundId && input.fundId !== existing.fundId) await assertUsableFund(input.organizationId, input.fundId);
  validateFrequencies(input.allowedFrequencies);

  const type = input.type ?? existing.type;
  const obligationNature = resolveObligationNature(type, input.obligationNature ?? existing.obligationNature);

  const program = await prisma.contributionProgram.update({
    where: { id: existing.id },
    data: {
      ...(input.fundId !== undefined ? { fundId: input.fundId } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
      type,
      obligationNature,
      ...(input.allowCustomAmount !== undefined ? { allowCustomAmount: input.allowCustomAmount } : {}),
      ...(input.suggestedAmounts !== undefined
        ? { suggestedAmounts: input.suggestedAmounts.map((value) => new Prisma.Decimal(value.toFixed(2))) }
        : {}),
      ...(input.defaultAmount !== undefined
        ? { defaultAmount: input.defaultAmount != null ? new Prisma.Decimal(input.defaultAmount.toFixed(2)) : null }
        : {}),
      ...(input.allowedFrequencies !== undefined ? { allowedFrequencies: input.allowedFrequencies } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.receiptLanguage !== undefined ? { receiptLanguage: input.receiptLanguage?.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail ?? null,
    action: "giving.program_updated",
    entityType: "contribution_program",
    entityId: program.id,
    metadata: { name: program.name, type: program.type, obligationNature: program.obligationNature },
  });
  return program;
}
