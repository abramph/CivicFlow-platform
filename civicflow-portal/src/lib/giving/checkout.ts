import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-B — one-time giving checkout validation + the webhook-side
 * recorder (docs/core-contributions-giving.md §2). MEMBER MONEY only.
 *
 * Split so the security-bearing pieces are pure and testable:
 *  - validateGivingRequest: everything the checkout route must verify before
 *    a Stripe session is created;
 *  - recordGivingContribution: everything the webhook does with a completed
 *    session — §50 tenant cross-check, payment-intent idempotency belt, and
 *    the durable Contribution row. The redirect never records anything.
 */

export interface GivingCheckoutInput {
  organizationId: string;
  fundId: string;
  amount: number;
  programId?: string | null;
  anonymityMode?: "NONE" | "PUBLICLY_ANONYMOUS";
  memo?: string | null;
}

export async function validateGivingRequest(input: GivingCheckoutInput) {
  await ensureContributionsEnabled(input.organizationId);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new FinanceError("Contribution amount must be greater than zero.");
  }
  const amount = Math.round(input.amount * 100) / 100;

  const fund = await prisma.fund.findFirst({ where: { id: input.fundId, organizationId: input.organizationId } });
  if (!fund) throw new FinanceError("Fund not found.", 404);
  if (fund.status !== "ACTIVE") throw new FinanceError(`"${fund.name}" is not currently accepting contributions.`, 409);
  if (!fund.allowOneTime) throw new FinanceError(`"${fund.name}" does not accept one-time contributions.`, 409);
  if (fund.minimumAmount !== null && amount < Number(fund.minimumAmount)) {
    throw new FinanceError(`The minimum contribution to ${fund.name} is $${Number(fund.minimumAmount).toFixed(2)}.`);
  }
  if (fund.maximumAmount !== null && amount > Number(fund.maximumAmount)) {
    throw new FinanceError(`The maximum contribution to ${fund.name} is $${Number(fund.maximumAmount).toFixed(2)}.`);
  }

  let program = null;
  if (input.programId) {
    program = await prisma.contributionProgram.findFirst({
      where: { id: input.programId, organizationId: input.organizationId },
    });
    if (!program) throw new FinanceError("Program not found.", 404);
    if (program.fundId !== fund.id) throw new FinanceError("That program does not belong to the selected fund.", 409);
    if (program.status !== "ACTIVE") throw new FinanceError(`"${program.name}" is not currently active.`, 409);
    if (!program.allowCustomAmount) {
      const suggested = program.suggestedAmounts.map((value) => Number(value));
      if (!suggested.includes(amount)) {
        throw new FinanceError(`"${program.name}" offers fixed amounts: ${suggested.map((v) => `$${v}`).join(", ")}.`);
      }
    }
  }

  return { amount, fund, program };
}

export interface RecordGivingInput {
  /** Values from Stripe session METADATA (stamped server-side at checkout). */
  organizationId: string;
  fundId: string;
  programId?: string | null;
  memberId?: string | null;
  contributorUserId?: string | null;
  anonymityMode?: string | null;
  memo?: string | null;
  /** Values from the Stripe session OBJECT (provider truth). */
  amountTotalCents: number;
  currency: string;
  providerPaymentIntentId: string | null;
  providerSessionId: string;
}

export type RecordGivingResult =
  | { outcome: "RECORDED"; contributionId: string; contributionNumber: string | null }
  | { outcome: "DUPLICATE"; contributionId: string }
  | { outcome: "REJECTED"; reason: string };

/** Webhook-side recorder. Returns REJECTED (and records NOTHING) on any §50
 * linkage inconsistency — the caller logs a security-safe event. */
export async function recordGivingContribution(input: RecordGivingInput): Promise<RecordGivingResult> {
  // §50 tenant cross-check: the fund named by metadata must exist inside the
  // organization named by metadata, and must still be usable.
  const fund = await prisma.fund.findFirst({ where: { id: input.fundId, organizationId: input.organizationId } });
  if (!fund) return { outcome: "REJECTED", reason: "fund_org_mismatch" };
  if (fund.status === "ARCHIVED" || fund.status === "CLOSED") {
    return { outcome: "REJECTED", reason: "fund_not_open" };
  }
  if (input.programId) {
    const program = await prisma.contributionProgram.findFirst({
      where: { id: input.programId, organizationId: input.organizationId, fundId: input.fundId },
    });
    if (!program) return { outcome: "REJECTED", reason: "program_linkage_mismatch" };
  }
  if (!Number.isInteger(input.amountTotalCents) || input.amountTotalCents <= 0) {
    return { outcome: "REJECTED", reason: "invalid_amount" };
  }

  // Idempotency belt beyond StripeWebhookEvent dedup: one contribution per
  // payment intent / session, ever.
  const reference = input.providerPaymentIntentId ?? input.providerSessionId;
  const existing = await prisma.contribution.findFirst({
    where: { organizationId: input.organizationId, providerPaymentIntentId: reference },
    select: { id: true },
  });
  if (existing) return { outcome: "DUPLICATE", contributionId: existing.id };

  const program = input.programId
    ? await prisma.contributionProgram.findFirst({ where: { id: input.programId }, select: { taxDeductibility: true } })
    : null;
  const anonymityMode = input.anonymityMode === "PUBLICLY_ANONYMOUS" ? "PUBLICLY_ANONYMOUS" : "NONE";

  const { withContributionNumber } = await import("./contribution-numbers");
  const contribution = await withContributionNumber(input.organizationId, (contributionNumber) =>
    prisma.contribution.create({
      data: {
        organizationId: input.organizationId,
        contributionNumber,
        fundId: input.fundId,
        contributionProgramId: input.programId ?? null,
        memberId: input.memberId || null,
        contributorUserId: input.contributorUserId || null,
        amount: input.amountTotalCents / 100,
        currency: input.currency.toUpperCase(),
        contributionDate: new Date(),
        paymentMethod: "STRIPE",
        source: "MEMBER_PROFILE",
        providerPaymentIntentId: reference,
        anonymityMode,
        statementEligible: true,
        taxDeductibilityClassification: program?.taxDeductibility ?? "DEDUCTIBILITY_NOT_CONFIGURED",
        notes: input.memo?.slice(0, 500) || null,
        receiptRequested: true,
      },
    })
  );

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.contributorUserId ?? null,
    action: "giving.contribution_recorded",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: { contributionNumber: contribution.contributionNumber, fundId: input.fundId, amountCents: input.amountTotalCents },
  });

  return { outcome: "RECORDED", contributionId: contribution.id, contributionNumber: contribution.contributionNumber };
}
