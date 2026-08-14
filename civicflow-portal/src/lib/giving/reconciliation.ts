import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/**
 * CORE-GIVE-F — the §51 reconciliation view. COMPUTED, read-only: nothing
 * here auto-corrects a financial discrepancy — it names them for a human.
 * Classification: MATCHED (implicit — not listed) / NEEDS_REVIEW /
 * PROVIDER_ONLY / UNESTRA_ONLY. REFUND_MISMATCH arrives with refunds (K).
 */

export interface ReconciliationItem {
  classification: "NEEDS_REVIEW" | "PROVIDER_ONLY" | "UNESTRA_ONLY";
  kind: string;
  description: string;
  reference: string;
  occurredAt: Date | null;
}

export async function getReconciliationReport(organizationId: string): Promise<{
  generatedAt: Date;
  items: ReconciliationItem[];
  checkedProviderWindowDays: number;
}> {
  const items: ReconciliationItem[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // ── Unestra-side anomalies ────────────────────────────────────────────────
  const [abandonedSetups, failedSchedules, numberlessProviderRows] = await Promise.all([
    prisma.recurringContributionSchedule.findMany({
      where: { organizationId, status: "PENDING_SETUP", createdAt: { lt: new Date(now - dayMs) } },
      select: { id: true, createdAt: true, amount: true, frequency: true },
      take: 50,
    }),
    prisma.recurringContributionSchedule.findMany({
      where: { organizationId, status: { in: ["PAYMENT_FAILED", "PAYMENT_ACTION_REQUIRED"] } },
      select: { id: true, lastAttemptAt: true, failureCount: true, fund: { select: { name: true } } },
      take: 50,
    }),
    prisma.contribution.findMany({
      where: {
        organizationId,
        contributionNumber: null,
        OR: [{ providerPaymentIntentId: { not: null } }, { providerInvoiceId: { not: null } }],
        fundId: { not: null },
      },
      select: { id: true, createdAt: true, providerPaymentIntentId: true },
      take: 50,
    }),
  ]);

  for (const schedule of abandonedSetups) {
    items.push({
      classification: "UNESTRA_ONLY",
      kind: "abandoned_recurring_setup",
      description: `Recurring setup started ${schedule.createdAt.toLocaleDateString("en-US")} ($${Number(schedule.amount)} ${schedule.frequency.toLowerCase()}) was never completed at the provider.`,
      reference: schedule.id,
      occurredAt: schedule.createdAt,
    });
  }
  for (const schedule of failedSchedules) {
    items.push({
      classification: "NEEDS_REVIEW",
      kind: "failed_recurring_payment",
      description: `Recurring contribution to ${schedule.fund.name} has ${schedule.failureCount} failed attempt(s) — the member has been notified; no debt accrues.`,
      reference: schedule.id,
      occurredAt: schedule.lastAttemptAt,
    });
  }
  for (const row of numberlessProviderRows) {
    items.push({
      classification: "NEEDS_REVIEW",
      kind: "missing_contribution_number",
      description: "A provider-processed contribution has no contribution number (unexpected for module-recorded rows).",
      reference: row.providerPaymentIntentId ?? row.id,
      occurredAt: row.createdAt,
    });
  }

  // Duplicate provider references (should be impossible — the idempotency
  // belt prevents it; surfacing proves it).
  const duplicates = await prisma.contribution.groupBy({
    by: ["providerPaymentIntentId"],
    where: { organizationId, providerPaymentIntentId: { not: null } },
    _count: true,
    having: { providerPaymentIntentId: { _count: { gt: 1 } } },
  });
  for (const duplicate of duplicates) {
    items.push({
      classification: "NEEDS_REVIEW",
      kind: "duplicate_provider_reference",
      description: "Two contributions share one provider payment reference — investigate before statements.",
      reference: duplicate.providerPaymentIntentId ?? "",
      occurredAt: null,
    });
  }

  // ── Provider-side sweep (last 7 days) ─────────────────────────────────────
  const stripe = getStripe();
  const since = Math.floor((now - 7 * dayMs) / 1000);
  try {
    const sessions = await stripe.checkout.sessions.list({ created: { gte: since }, limit: 100 });
    for (const session of sessions.data) {
      if (session.metadata?.organizationId !== organizationId) continue;
      if (session.metadata?.paymentType !== "giving") continue;
      if (session.payment_status !== "paid") continue;
      const reference = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? session.id);
      const recorded = await prisma.contribution.findFirst({
        where: { organizationId, providerPaymentIntentId: reference },
        select: { id: true },
      });
      if (!recorded) {
        items.push({
          classification: "PROVIDER_ONLY",
          kind: "paid_session_unrecorded",
          description: `A paid giving checkout (${((session.amount_total ?? 0) / 100).toFixed(2)} ${session.currency?.toUpperCase() ?? "USD"}) has no recorded contribution — check webhook delivery.`,
          reference,
          occurredAt: session.created ? new Date(session.created * 1000) : null,
        });
      }
    }

    const schedules = await prisma.recurringContributionSchedule.findMany({
      where: { organizationId, providerSubscriptionId: { not: null } },
      select: { providerSubscriptionId: true },
    });
    const ourSubscriptionIds = new Set(schedules.map((schedule) => schedule.providerSubscriptionId));
    const invoices = await stripe.invoices.list({ created: { gte: since }, status: "paid", limit: 100 });
    for (const invoice of invoices.data) {
      const subId = typeof invoice.subscription === "string" ? invoice.subscription : null;
      if (!subId || !ourSubscriptionIds.has(subId)) continue;
      const recorded = await prisma.contribution.findFirst({
        where: { organizationId, providerInvoiceId: invoice.id },
        select: { id: true },
      });
      if (!recorded) {
        items.push({
          classification: "PROVIDER_ONLY",
          kind: "paid_invoice_unrecorded",
          description: `A paid recurring-giving invoice (${((invoice.amount_paid ?? 0) / 100).toFixed(2)}) has no recorded contribution — check webhook delivery.`,
          reference: invoice.id ?? "",
          occurredAt: invoice.created ? new Date(invoice.created * 1000) : null,
        });
      }
    }
  } catch {
    items.push({
      classification: "NEEDS_REVIEW",
      kind: "provider_sweep_unavailable",
      description: "The provider-side sweep could not run — Unestra-side checks above are still valid.",
      reference: "stripe",
      occurredAt: new Date(),
    });
  }

  return { generatedAt: new Date(), items, checkedProviderWindowDays: 7 };
}
