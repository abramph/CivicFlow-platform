import type { RecurringFrequency } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FinanceError } from "@/lib/finance-errors";
import { logGivingEvent } from "./telemetry";
import { ensureContributionsEnabled } from "./module";

/**
 * CORE-GIVE-C — recurring giving (docs/core-contributions-giving.md §3).
 * Stripe owns EXECUTION (billing cycle, off-session charges, retries — the
 * single §17 retry authority); these functions own MEANING: the schedule
 * record, contribution recording, and the voluntary-giving invariants.
 *
 * INVARIANTS (§111/§112/§113, test-asserted):
 *  - No function here ever touches the SaaS Subscription table.
 *  - No failure path creates a DuesCharge, arrears, or any "owed" state —
 *    a failed voluntary contribution is a schedule status, not a debt.
 *  - Invoice recording is idempotent on the provider invoice id.
 */

export const SUPPORTED_CURRENCY = "USD";

export interface RecurringRequestInput {
  organizationId: string;
  fundId: string;
  amount: number;
  frequency: RecurringFrequency;
  programId?: string | null;
  /// CORE-GIVE-E: pin the schedule to the caller's own pledge — every
  /// invoice contribution inherits the credit.
  pledgeId?: string | null;
  confirmDuplicate?: boolean;
  contributorUserId: string;
  /** CONNECT-F (§40): member's opt-in at setup time. Ignored (stored false)
   * if the org's mode isn't OPTIONAL_CONTRIBUTOR_COVERAGE — never silently
   * charges a coverage the org didn't configure. */
  coverProcessingCosts?: boolean;
}

export async function validateRecurringRequest(input: RecurringRequestInput) {
  await ensureContributionsEnabled(input.organizationId);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new FinanceError("Contribution amount must be greater than zero.");
  }
  const amount = Math.round(input.amount * 100) / 100;

  const fund = await prisma.fund.findFirst({ where: { id: input.fundId, organizationId: input.organizationId } });
  if (!fund) throw new FinanceError("Fund not found.", 404);
  if (fund.status !== "ACTIVE") throw new FinanceError(`"${fund.name}" is not currently accepting contributions.`, 409);
  if (!fund.allowRecurring) throw new FinanceError(`"${fund.name}" does not accept recurring contributions.`, 409);
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
    if (program.allowedFrequencies.length > 0 && !program.allowedFrequencies.includes(input.frequency)) {
      throw new FinanceError(`"${program.name}" offers: ${program.allowedFrequencies.join(", ").toLowerCase()}.`);
    }
  }

  // §92 duplicate-schedule guard: same fund + frequency, live status.
  if (!input.confirmDuplicate) {
    const duplicate = await prisma.recurringContributionSchedule.findFirst({
      where: {
        organizationId: input.organizationId,
        contributorUserId: input.contributorUserId,
        fundId: fund.id,
        frequency: input.frequency,
        status: { in: ["PENDING_SETUP", "ACTIVE", "PAUSED", "PAYMENT_ACTION_REQUIRED", "PAYMENT_FAILED"] },
      },
    });
    if (duplicate) {
      throw new FinanceError(
        `You already have a ${input.frequency.toLowerCase()} contribution to ${fund.name}. Confirm if you really want a second one.`,
        409
      );
    }
  }

  return { amount, fund, program };
}

/** Creates the PENDING_SETUP schedule row the checkout session will carry. */
export async function createPendingSchedule(input: RecurringRequestInput & { memberId?: string | null }) {
  const { amount, fund, program } = await validateRecurringRequest(input);
  if (input.pledgeId) {
    const { validatePledgeForGiving } = await import("./pledges");
    await validatePledgeForGiving({
      organizationId: input.organizationId,
      contributorUserId: input.contributorUserId,
      pledgeId: input.pledgeId,
      fundId: fund.id,
    });
  }
  // CONNECT-F (§40): the toggle only ever takes effect if the org currently
  // offers it — requesting it while OFF (or the older STRIPE_SURCHARGE-only
  // future state) silently stores false rather than erroring, since this is
  // a best-effort UI preference, not a validated financial input.
  const { getProcessingCostCoverageSettings } = await import("./processing-cost-coverage");
  const coverageSettings = await getProcessingCostCoverageSettings(input.organizationId);
  const coverProcessingCosts = Boolean(input.coverProcessingCosts) && coverageSettings.mode === "OPTIONAL_CONTRIBUTOR_COVERAGE";
  const schedule = await prisma.recurringContributionSchedule.create({
    data: {
      organizationId: input.organizationId,
      memberId: input.memberId ?? null,
      contributorUserId: input.contributorUserId,
      fundId: fund.id,
      pledgeId: input.pledgeId ?? null,
      contributionProgramId: program?.id ?? null,
      amount: new Prisma.Decimal(amount.toFixed(2)),
      currency: SUPPORTED_CURRENCY,
      frequency: input.frequency,
      status: "PENDING_SETUP",
      coverProcessingCosts,
    },
  });
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.contributorUserId,
    action: "giving.recurring_setup_started",
    entityType: "recurring_contribution_schedule",
    entityId: schedule.id,
    metadata: { fundId: fund.id, amount, frequency: input.frequency },
  });
  return { schedule, fund, program, amount };
}

/** checkout.session.completed (subscription mode, giving metadata): link the
 * provider subscription to OUR schedule after the §50 cross-check. */
export async function linkScheduleFromCheckout(input: {
  scheduleId: string;
  organizationId: string;
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  /** CONNECT-D (§56): the connected account that owns the subscription —
   * from `event.account`, never from metadata. Immutable once stamped. */
  stripeConnectedAccountId?: string | null;
}): Promise<"LINKED" | "REJECTED"> {
  const schedule = await prisma.recurringContributionSchedule.findFirst({
    where: { id: input.scheduleId, organizationId: input.organizationId },
  });
  if (!schedule) return "REJECTED";
  await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: {
      providerSubscriptionId: input.providerSubscriptionId,
      providerCustomerId: input.providerCustomerId,
      status: schedule.status === "PENDING_SETUP" ? "ACTIVE" : schedule.status,
      ...(input.stripeConnectedAccountId
        ? { stripeConnectedAccountId: input.stripeConnectedAccountId, providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT" }
        : {}),
    },
  });
  const { createAuditEvent } = await import("@/lib/audit");
  logGivingEvent("GIVING_RECURRING_CREATED", { organizationId: schedule.organizationId, scheduleId: schedule.id });
  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: schedule.contributorUserId,
    action: "giving.recurring_started",
    entityType: "recurring_contribution_schedule",
    entityId: schedule.id,
    metadata: { frequency: schedule.frequency, amount: Number(schedule.amount) },
  });
  return "LINKED";
}

export interface RecurringInvoiceInput {
  providerSubscriptionId: string;
  providerInvoiceId: string;
  amountPaidCents: number;
  currency: string;
  periodEnd: number | null;
  paymentIntentId: string | null;
  defaultPaymentMethodDescriptor?: string | null;
}

export type RecurringInvoiceResult =
  | { outcome: "RECORDED"; contributionId: string; organizationId: string }
  | { outcome: "DUPLICATE" }
  | { outcome: "NOT_GIVING" }
  | { outcome: "REJECTED"; reason: string };

/** invoice.paid: schedule is resolved by OUR unique providerSubscriptionId —
 * never by trusting invoice metadata. Idempotent on the invoice id. */
export async function recordRecurringInvoicePaid(input: RecurringInvoiceInput): Promise<RecurringInvoiceResult> {
  const schedule = await prisma.recurringContributionSchedule.findUnique({
    where: { providerSubscriptionId: input.providerSubscriptionId },
    include: { contributionProgram: { select: { taxDeductibility: true } } },
  });
  if (!schedule) return { outcome: "NOT_GIVING" };
  if (!Number.isInteger(input.amountPaidCents) || input.amountPaidCents <= 0) {
    return { outcome: "REJECTED", reason: "invalid_amount" };
  }

  const existing = await prisma.contribution.findFirst({
    where: { organizationId: schedule.organizationId, providerInvoiceId: input.providerInvoiceId },
    select: { id: true },
  });
  if (existing) return { outcome: "DUPLICATE" };

  // CONNECT-F (§40): the schedule's own `amount` is the immutable
  // fund-principal figure — whatever Stripe actually invoiced beyond that
  // is coverage, however it was computed (the org's rate at the time the
  // subscription item was last priced). No recomputation from a possibly
  // different CURRENT rate.
  const baseCents = Math.round(Number(schedule.amount) * 100);
  const coverageCents = schedule.coverProcessingCosts ? Math.max(input.amountPaidCents - baseCents, 0) : 0;
  const recordedBaseCents = input.amountPaidCents - coverageCents;

  const { withContributionNumber } = await import("./contribution-numbers");
  const contribution = await withContributionNumber(schedule.organizationId, (contributionNumber) =>
    prisma.contribution.create({
      data: {
        organizationId: schedule.organizationId,
        contributionNumber,
        fundId: schedule.fundId,
        contributionProgramId: schedule.contributionProgramId,
        recurringScheduleId: schedule.id,
        pledgeId: schedule.pledgeId,
        memberId: schedule.memberId,
        contributorUserId: schedule.contributorUserId,
        amount: recordedBaseCents / 100,
        processingCostCoverageAmount: coverageCents > 0 ? coverageCents / 100 : null,
        totalChargedAmount: input.amountPaidCents / 100,
        currency: input.currency.toUpperCase(),
        contributionDate: new Date(),
        paymentMethod: "STRIPE",
        source: "MEMBER_PROFILE",
        providerInvoiceId: input.providerInvoiceId,
        providerPaymentIntentId: input.paymentIntentId,
        // CONNECT-D (§56): attribution comes from the SCHEDULE's own
        // immutable stamp, never re-derived from the invoice/event.
        stripeConnectedAccountId: schedule.stripeConnectedAccountId,
        providerAccountContext: schedule.providerAccountContext,
        taxDeductibilityClassification: schedule.contributionProgram?.taxDeductibility ?? "DEDUCTIBILITY_NOT_CONFIGURED",
        receiptRequested: true,
      },
    })
  );

  if (schedule.pledgeId) {
    const { markFulfilledIfComplete } = await import("./pledges");
    await markFulfilledIfComplete(schedule.organizationId, schedule.pledgeId);
  }

  await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: {
      status: "ACTIVE",
      failureCount: 0,
      lastSuccessfulContributionAt: new Date(),
      lastAttemptAt: new Date(),
      nextContributionDate: input.periodEnd ? new Date(input.periodEnd * 1000) : null,
      ...(input.defaultPaymentMethodDescriptor ? { paymentMethodDescriptor: input.defaultPaymentMethodDescriptor } : {}),
    },
  });

  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: schedule.organizationId,
    actorUserId: schedule.contributorUserId,
    action: "giving.recurring_contribution_recorded",
    entityType: "contribution",
    entityId: contribution.id,
    metadata: { scheduleId: schedule.id, amountCents: input.amountPaidCents },
  });
  return { outcome: "RECORDED", contributionId: contribution.id, organizationId: schedule.organizationId };
}

/** invoice.payment_failed: a schedule status, NEVER a debt (§16/§112). */
export async function markRecurringInvoiceFailed(input: {
  providerSubscriptionId: string;
  requiresAction: boolean;
}): Promise<"MARKED" | "NOT_GIVING"> {
  const schedule = await prisma.recurringContributionSchedule.findUnique({
    where: { providerSubscriptionId: input.providerSubscriptionId },
  });
  if (!schedule) return "NOT_GIVING";
  await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: {
      status: input.requiresAction ? "PAYMENT_ACTION_REQUIRED" : "PAYMENT_FAILED",
      failureCount: { increment: 1 },
      lastAttemptAt: new Date(),
    },
  });
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId: schedule.organizationId,
    actorUserId: schedule.contributorUserId,
    action: "giving.recurring_payment_failed",
    entityType: "recurring_contribution_schedule",
    entityId: schedule.id,
    metadata: { requiresAction: input.requiresAction },
  });
  return "MARKED";
}

/** customer.subscription.updated/deleted for giving subscriptions: mirror
 * provider truth onto the schedule. Never touches the SaaS Subscription. */
export async function syncScheduleFromSubscription(input: {
  providerSubscriptionId: string;
  providerStatus: string;
  cancelAtPeriodEnd: boolean;
  deleted: boolean;
}): Promise<"SYNCED" | "NOT_GIVING"> {
  const schedule = await prisma.recurringContributionSchedule.findUnique({
    where: { providerSubscriptionId: input.providerSubscriptionId },
  });
  if (!schedule) return "NOT_GIVING";

  if (input.deleted || input.providerStatus === "canceled") {
    if (schedule.status !== "CANCELLED") {
      await prisma.recurringContributionSchedule.update({
        where: { id: schedule.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      const { createAuditEvent } = await import("@/lib/audit");
      await createAuditEvent({
        organizationId: schedule.organizationId,
        actorUserId: schedule.contributorUserId,
        action: "giving.recurring_cancelled",
        entityType: "recurring_contribution_schedule",
        entityId: schedule.id,
        metadata: { via: "provider" },
      });
    }
    return "SYNCED";
  }
  if (input.providerStatus === "paused") {
    await prisma.recurringContributionSchedule.update({
      where: { id: schedule.id },
      data: { status: "PAUSED", pausedAt: schedule.pausedAt ?? new Date() },
    });
  }
  return "SYNCED";
}

/** Member's own schedules — scoping lives in the query. */
export async function listMySchedules(organizationId: string, contributorUserId: string) {
  return prisma.recurringContributionSchedule.findMany({
    where: { organizationId, contributorUserId, status: { not: "PENDING_SETUP" } },
    orderBy: { createdAt: "desc" },
    include: { fund: { select: { name: true } }, contributionProgram: { select: { name: true } } },
  });
}
