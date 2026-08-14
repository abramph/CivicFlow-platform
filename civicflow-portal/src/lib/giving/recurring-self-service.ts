import type { RecurringFrequency } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { FinanceError } from "@/lib/finance-errors";
import { stripeIntervalFor } from "./giving-stripe";

/**
 * CORE-GIVE-D — member self-service on their OWN recurring schedules
 * (docs/core-contributions-giving.md §4). Rules enforced here:
 *  - ownership: contributorUserId must match the caller inside their org —
 *    anything else is a 404 (§111.5);
 *  - provider-first: the Stripe mutation succeeds before any local update;
 *  - voluntary invariants: pause voids (never accumulates), cancel is
 *    immediate and final, failure copy never implies debt;
 *  - every change is audited and the member is notified (§61).
 */

export async function authorizeOwnSchedule(organizationId: string, contributorUserId: string, scheduleId: string) {
  const schedule = await prisma.recurringContributionSchedule.findFirst({
    where: { id: scheduleId, organizationId, contributorUserId },
    include: { fund: { select: { name: true } } },
  });
  if (!schedule) throw new FinanceError("Recurring schedule not found.", 404);
  return schedule;
}

async function notifyMember(contributorUserId: string, subject: string, lines: string[]) {
  try {
    const user = await prisma.user.findUnique({ where: { id: contributorUserId }, select: { email: true } });
    if (!user?.email) return;
    const { sendEmail } = await import("@/lib/mail");
    await sendEmail({ to: user.email, subject, text: lines.join("\n") });
  } catch {
    // Notification failure never fails the action itself.
  }
}

async function audit(
  organizationId: string,
  actorUserId: string,
  action: string,
  scheduleId: string,
  metadata: Record<string, string | number | boolean | null>
) {
  const { createAuditEvent } = await import("@/lib/audit");
  await createAuditEvent({
    organizationId,
    actorUserId,
    action,
    entityType: "recurring_contribution_schedule",
    entityId: scheduleId,
    metadata,
  });
}

async function getSubscriptionItemId(providerSubscriptionId: string): Promise<{ itemId: string; productId: string }> {
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(providerSubscriptionId);
  const item = subscription.items.data[0];
  if (!item) throw new FinanceError("The provider subscription has no item to update.", 502);
  const productId = typeof item.price.product === "string" ? item.price.product : item.price.product.id;
  return { itemId: item.id, productId };
}

/** §12 — new amount applies at the NEXT scheduled contribution; never any
 * proration for voluntary schedules. */
export async function changeAmount(input: {
  organizationId: string;
  contributorUserId: string;
  scheduleId: string;
  newAmount: number;
}) {
  const schedule = await authorizeOwnSchedule(input.organizationId, input.contributorUserId, input.scheduleId);
  if (!schedule.providerSubscriptionId) throw new FinanceError("This schedule is not active with the payment provider.", 409);
  if (!Number.isFinite(input.newAmount) || input.newAmount <= 0) throw new FinanceError("Amount must be greater than zero.");
  if (schedule.status === "CANCELLED" || schedule.status === "COMPLETED") {
    throw new FinanceError("A cancelled schedule cannot be changed — set up a new one instead.", 409);
  }
  const newAmount = Math.round(input.newAmount * 100) / 100;
  const oldAmount = Number(schedule.amount);
  if (newAmount === oldAmount) return schedule;

  const stripe = getStripe();
  const { itemId, productId } = await getSubscriptionItemId(schedule.providerSubscriptionId);
  await stripe.subscriptionItems.update(itemId, {
    price_data: {
      currency: "usd",
      product: productId,
      recurring: stripeIntervalFor(schedule.frequency),
      unit_amount: Math.round(newAmount * 100),
    },
    proration_behavior: "none",
  });

  const updated = await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: { amount: new Prisma.Decimal(newAmount.toFixed(2)) },
  });
  await audit(input.organizationId, input.contributorUserId, "giving.recurring_amount_changed", schedule.id, {
    oldAmount,
    newAmount,
    appliesFrom: "next_contribution",
  });
  await notifyMember(input.contributorUserId, "Your recurring contribution amount was updated", [
    `Your recurring contribution to ${schedule.fund.name} changed from $${oldAmount.toFixed(2)} to $${newAmount.toFixed(2)}.`,
    "The new amount applies starting with your next scheduled contribution.",
  ]);
  return updated;
}

/** §13 — the already-scheduled next date stays; the interval after it
 * changes. Nothing is invoiced at change time, so no duplicates. */
export async function changeFrequency(input: {
  organizationId: string;
  contributorUserId: string;
  scheduleId: string;
  newFrequency: RecurringFrequency;
}) {
  const schedule = await authorizeOwnSchedule(input.organizationId, input.contributorUserId, input.scheduleId);
  if (!schedule.providerSubscriptionId) throw new FinanceError("This schedule is not active with the payment provider.", 409);
  if (schedule.status === "CANCELLED" || schedule.status === "COMPLETED") {
    throw new FinanceError("A cancelled schedule cannot be changed — set up a new one instead.", 409);
  }
  if (schedule.frequency === input.newFrequency) return schedule;

  const stripe = getStripe();
  const { itemId, productId } = await getSubscriptionItemId(schedule.providerSubscriptionId);
  await stripe.subscriptionItems.update(itemId, {
    price_data: {
      currency: "usd",
      product: productId,
      recurring: stripeIntervalFor(input.newFrequency),
      unit_amount: Math.round(Number(schedule.amount) * 100),
    },
    proration_behavior: "none",
  });

  const updated = await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: { frequency: input.newFrequency },
  });
  await audit(input.organizationId, input.contributorUserId, "giving.recurring_frequency_changed", schedule.id, {
    oldFrequency: schedule.frequency,
    newFrequency: input.newFrequency,
  });
  await notifyMember(input.contributorUserId, "Your recurring contribution frequency was updated", [
    `Your recurring contribution to ${schedule.fund.name} is now ${input.newFrequency.toLowerCase()}.`,
    "Your next contribution date is unchanged; the new frequency applies after it.",
  ]);
  return updated;
}

/** §14 — pause voids future periods (nothing accumulates; membership and
 * dues untouched by construction). */
export async function pauseSchedule(input: { organizationId: string; contributorUserId: string; scheduleId: string }) {
  const schedule = await authorizeOwnSchedule(input.organizationId, input.contributorUserId, input.scheduleId);
  if (!schedule.providerSubscriptionId) throw new FinanceError("This schedule is not active with the payment provider.", 409);
  if (schedule.status !== "ACTIVE" && schedule.status !== "PAYMENT_FAILED" && schedule.status !== "PAYMENT_ACTION_REQUIRED") {
    throw new FinanceError("Only an active schedule can be paused.", 409);
  }

  const stripe = getStripe();
  await stripe.subscriptions.update(schedule.providerSubscriptionId, { pause_collection: { behavior: "void" } });

  const updated = await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: { status: "PAUSED", pausedAt: new Date() },
  });
  await audit(input.organizationId, input.contributorUserId, "giving.recurring_paused", schedule.id, {});
  await notifyMember(input.contributorUserId, "Your recurring contribution is paused", [
    `Your recurring contribution to ${schedule.fund.name} is paused. Nothing will be charged while paused, and no balance accumulates.`,
    "Resume any time from your Giving page.",
  ]);
  return updated;
}

/** Resume: clears the pause and reads the REAL next date back from the
 * provider — no surprise immediate charge (§14). */
export async function resumeSchedule(input: { organizationId: string; contributorUserId: string; scheduleId: string }) {
  const schedule = await authorizeOwnSchedule(input.organizationId, input.contributorUserId, input.scheduleId);
  if (!schedule.providerSubscriptionId) throw new FinanceError("This schedule is not active with the payment provider.", 409);
  if (schedule.status !== "PAUSED") throw new FinanceError("Only a paused schedule can be resumed.", 409);

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.update(schedule.providerSubscriptionId, { pause_collection: null });
  const nextDate = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;

  const updated = await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: { status: "ACTIVE", resumedAt: new Date(), nextContributionDate: nextDate },
  });
  await audit(input.organizationId, input.contributorUserId, "giving.recurring_resumed", schedule.id, {
    nextContributionDate: nextDate?.toISOString() ?? null,
  });
  await notifyMember(input.contributorUserId, "Your recurring contribution has resumed", [
    `Your recurring contribution to ${schedule.fund.name} is active again.`,
    nextDate ? `Next contribution: ${nextDate.toLocaleDateString("en-US", { dateStyle: "long" })}.` : "",
  ]);
  return updated;
}

export const CANCEL_REASONS = [
  "financial_circumstances",
  "changing_amount",
  "switching_frequency",
  "prefer_manual_giving",
  "no_longer_participating",
  "other",
  "prefer_not_to_say",
] as const;

/** §15 — immediate, honest cancellation. Reason optional. History stays. */
export async function cancelSchedule(input: {
  organizationId: string;
  contributorUserId: string;
  scheduleId: string;
  reason?: string | null;
}) {
  const schedule = await authorizeOwnSchedule(input.organizationId, input.contributorUserId, input.scheduleId);
  if (schedule.status === "CANCELLED") return schedule;
  if (input.reason && !CANCEL_REASONS.includes(input.reason as (typeof CANCEL_REASONS)[number])) {
    throw new FinanceError("Unknown cancellation reason.");
  }

  if (schedule.providerSubscriptionId) {
    const stripe = getStripe();
    await stripe.subscriptions.cancel(schedule.providerSubscriptionId);
  }

  const updated = await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason ?? null, nextContributionDate: null },
  });
  await audit(input.organizationId, input.contributorUserId, "giving.recurring_cancelled", schedule.id, {
    via: "self_service",
    reason: input.reason ?? null,
  });
  await notifyMember(input.contributorUserId, "Your recurring contribution is cancelled", [
    `Your recurring contribution to ${schedule.fund.name} is cancelled. No future contribution will be scheduled.`,
    "Your giving history remains available on your Giving page. Thank you for your support.",
  ]);
  return updated;
}

/** §8 — collect a NEW payment method via a Stripe SETUP-mode session; card
 * data never touches Unestra. The webhook applies it. */
export async function startPaymentMethodUpdate(input: {
  organizationId: string;
  contributorUserId: string;
  scheduleId: string;
  baseUrl: string;
}): Promise<string> {
  const schedule = await authorizeOwnSchedule(input.organizationId, input.contributorUserId, input.scheduleId);
  if (!schedule.providerSubscriptionId || !schedule.providerCustomerId) {
    throw new FinanceError("This schedule is not active with the payment provider.", 409);
  }
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: schedule.providerCustomerId,
    success_url: `${input.baseUrl}/m/giving?org=${encodeURIComponent(input.organizationId)}&pm=updated`,
    cancel_url: `${input.baseUrl}/m/giving?org=${encodeURIComponent(input.organizationId)}`,
    metadata: {
      product: "Unestra Giving",
      paymentType: "giving-method-update",
      organizationId: input.organizationId,
      scheduleId: schedule.id,
    },
  });
  if (!session.url) throw new FinanceError("The payment provider did not return a URL.", 502);
  return session.url;
}

/** Webhook side of the method update (checkout.session.completed, mode
 * setup): attach the new method as the subscription default and refresh the
 * stored descriptor. Org-scoped schedule resolution = the §50 cross-check. */
export async function applyPaymentMethodUpdate(input: {
  organizationId: string;
  scheduleId: string;
  setupIntentId: string;
}): Promise<"APPLIED" | "REJECTED"> {
  const schedule = await prisma.recurringContributionSchedule.findFirst({
    where: { id: input.scheduleId, organizationId: input.organizationId },
  });
  if (!schedule || !schedule.providerSubscriptionId) return "REJECTED";

  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId);
  const paymentMethodId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id;
  if (!paymentMethodId) return "REJECTED";

  await stripe.subscriptions.update(schedule.providerSubscriptionId, { default_payment_method: paymentMethodId });
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  const descriptor = method.card ? `${method.card.brand.toUpperCase()} •••• ${method.card.last4}` : method.type;

  await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: { providerPaymentMethodId: paymentMethodId, paymentMethodDescriptor: descriptor },
  });
  await audit(input.organizationId, schedule.contributorUserId, "giving.recurring_payment_method_changed", schedule.id, {
    descriptor,
  });
  await notifyMember(schedule.contributorUserId, "Your giving payment method was updated", [
    `Future contributions will use ${descriptor}.`,
  ]);
  return "APPLIED";
}

/** §16 Try Again — pays the schedule's own latest OPEN invoice; recording
 * flows through the normal invoice.paid webhook. Never a second retry
 * engine: one member-initiated attempt of an existing invoice. */
export async function retryFailedPayment(input: { organizationId: string; contributorUserId: string; scheduleId: string }) {
  const schedule = await authorizeOwnSchedule(input.organizationId, input.contributorUserId, input.scheduleId);
  if (!schedule.providerSubscriptionId) throw new FinanceError("This schedule is not active with the payment provider.", 409);
  if (schedule.status !== "PAYMENT_FAILED" && schedule.status !== "PAYMENT_ACTION_REQUIRED") {
    throw new FinanceError("This schedule has no failed payment to retry.", 409);
  }

  const stripe = getStripe();
  const invoices = await stripe.invoices.list({ subscription: schedule.providerSubscriptionId, status: "open", limit: 1 });
  const openInvoice = invoices.data[0];
  if (!openInvoice?.id) throw new FinanceError("No open payment attempt was found — it may have already succeeded.", 409);

  try {
    await stripe.invoices.pay(openInvoice.id);
  } catch {
    throw new FinanceError("Your contribution could not be processed. Try updating your payment method.", 402);
  }
  await prisma.recurringContributionSchedule.update({
    where: { id: schedule.id },
    data: { lastAttemptAt: new Date() },
  });
  return { attempted: true };
}
