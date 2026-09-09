import { prisma } from "@/lib/prisma";
import { getPlatformSmsSettings } from "@/lib/sms-credentials";
import { SMS_OVERAGE_POLICY } from "@/lib/sms-pricing";

export interface SmsEntitlement {
  allowed: boolean;
  reason?: string;
  remaining: number;
  limit: number;
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * The single source of truth for "can this org send SMS right now" — always
 * recomputed live from OrganizationSmsSettings.smsAddOnActive plus the org's
 * current Subscription.status. Never trust a cached "smsEnabled" flag for
 * this, the same way auth-guards.ts never trusts a cached permission.
 */
export async function getSmsEntitlement(organizationId: string): Promise<SmsEntitlement> {
  const [settings, subscription, organization, platformSettings] = await Promise.all([
    prisma.organizationSmsSettings.findUnique({ where: { organizationId } }),
    prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { billingExempt: true } }),
    getPlatformSmsSettings(),
  ]);

  if (!platformSettings.orgMessagingEnabled) {
    return {
      allowed: false,
      reason: "Organization SMS messaging is currently disabled platform-wide.",
      remaining: 0,
      limit: 0,
    };
  }

  if (!settings || !settings.smsAddOnActive) {
    return {
      allowed: false,
      reason: "Your organization does not have the SMS add-on enabled.",
      remaining: 0,
      limit: 0,
    };
  }

  if (settings.suspendedAt) {
    return {
      allowed: false,
      reason: "SMS messaging has been suspended for your organization by a platform administrator.",
      remaining: 0,
      limit: settings.smsMonthlyLimit,
    };
  }

  // Base-billing prerequisite. billingExempt (internal/platform-owned orgs,
  // e.g. demo organizations — see the Organization.billingExempt schema doc)
  // satisfies ONLY this prerequisite; it never grants SMS by itself. The
  // explicit smsAddOnActive enrollment above — written solely through the
  // audited super-admin endpoint or the Stripe purchase flow — is still
  // required. Because this whole function is recomputed live on every send,
  // removing an org's billing exemption reconciles automatically: the next
  // send re-evaluates and (absent an active subscription) is denied — no
  // stale entitlement survives the flag flip.
  const hasActiveSubscription = Boolean(subscription && ACTIVE_STATUSES.has(subscription.status));
  if (!hasActiveSubscription && !organization?.billingExempt) {
    return {
      allowed: false,
      reason: "Your organization's subscription is not active.",
      remaining: 0,
      limit: settings.smsMonthlyLimit,
    };
  }

  // Lazily roll the billing period forward if it has elapsed — the Stripe
  // webhook also does this on each renewal event, but this is a backup for
  // when a webhook is delayed or missed. Conditioned on the exact
  // smsBillingPeriodEnd we just read so two concurrent checks (or this and
  // reserveSmsAllowance's own atomic rollover below) can never double-reset
  // the counter: the loser's where-clause simply matches nothing.
  let usedThisPeriod = settings.smsUsedThisPeriod;
  const now = new Date();
  if (settings.smsBillingPeriodEnd && now > settings.smsBillingPeriodEnd) {
    const newEnd = new Date(now);
    newEnd.setMonth(newEnd.getMonth() + 1);
    const rolled = await prisma.organizationSmsSettings.updateMany({
      where: { organizationId, smsBillingPeriodEnd: settings.smsBillingPeriodEnd },
      data: { smsUsedThisPeriod: 0, smsBillingPeriodStart: now, smsBillingPeriodEnd: newEnd },
    });
    if (rolled.count === 1) usedThisPeriod = 0;
  }

  // Monthly quota. Under "metered_overage" (Option B — requires the Stripe
  // overage-invoicing implementation) this is a soft cap tracked for
  // invoicing at smsOverageRateCents/message. Under "hard_stop" (Option A)
  // and while the policy is "unresolved", sending stops at the limit — the
  // 2026-09 audit found overage was metered but never billed, and an
  // unbilled soft cap must not be silently retained. See SMS_OVERAGE_POLICY
  // in lib/sms-pricing.ts (owner decision gate).
  if (SMS_OVERAGE_POLICY !== "metered_overage" && usedThisPeriod >= settings.smsMonthlyLimit) {
    return {
      allowed: false,
      reason: "Your organization has used its full monthly SMS allowance.",
      remaining: 0,
      limit: settings.smsMonthlyLimit,
    };
  }

  return { allowed: true, remaining: settings.smsMonthlyLimit - usedThisPeriod, limit: settings.smsMonthlyLimit };
}

/**
 * Database-atomic allowance reservation — THE hard-stop enforcement point,
 * called immediately before every organization-message Twilio call (initial
 * sends in sms-service.ts and retries in sms-queue.ts). getSmsEntitlement's
 * quota check above is a read-only pre-check for good error messages; under
 * concurrency it can race, so it must never be the thing that gates Twilio.
 *
 * A single conditional UPDATE claims one unit only while
 * smsUsedThisPeriod < smsMonthlyLimit — Postgres row-locks the settings row
 * for the statement, so with N concurrent senders and R remaining allowance,
 * exactly R reservations succeed and the rest observe an affected-row count
 * of 0 and fail closed. The same statement atomically handles an elapsed
 * billing period (reset-and-claim as unit #1 of the new period), so rollover
 * can never race a reservation into an over- or under-count.
 *
 * Fail-closed tradeoff, documented deliberately: a crash between a
 * successful reservation and the Twilio call permanently consumes that unit
 * (the send never happened, the counter says it did). We accept losing a
 * unit of capacity over any risk of an over-quota send — undoing it safely
 * would require a per-message reservation ledger (schema change), which the
 * owner has not authorized. Synchronous Twilio failures DO release their
 * unit via releaseSmsAllowance below.
 *
 * NOTE for a future "metered_overage" policy: this reservation enforces the
 * hard stop by construction; Option B would need a different claim rule.
 */
export async function reserveSmsAllowance(organizationId: string): Promise<boolean> {
  // Timestamp columns are Prisma DateTime → `timestamp(3)` WITHOUT time
  // zone, storing UTC wall-clock values. Comparing them against bare NOW()
  // (a timestamptz) makes Postgres interpret the stored naive value in the
  // SESSION time zone — off by the server's UTC offset on any non-UTC
  // server. `NOW() AT TIME ZONE 'UTC'` yields the naive-UTC "now" that
  // matches Prisma's storage convention (caught by
  // sms-quota-reservation.integration.test.ts on a non-UTC dev server).
  const reserved = await prisma.$executeRaw`
    UPDATE "OrganizationSmsSettings"
    SET
      "smsUsedThisPeriod" = CASE
        WHEN "smsBillingPeriodEnd" IS NOT NULL AND "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC') THEN 1
        ELSE "smsUsedThisPeriod" + 1
      END,
      "smsBillingPeriodStart" = CASE
        WHEN "smsBillingPeriodEnd" IS NOT NULL AND "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC') THEN (NOW() AT TIME ZONE 'UTC')
        ELSE "smsBillingPeriodStart"
      END,
      "smsBillingPeriodEnd" = CASE
        WHEN "smsBillingPeriodEnd" IS NOT NULL AND "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC') THEN (NOW() AT TIME ZONE 'UTC') + interval '1 month'
        ELSE "smsBillingPeriodEnd"
      END,
      "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "organizationId" = ${organizationId}
      AND (
        ("smsBillingPeriodEnd" IS NOT NULL AND "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC') AND "smsMonthlyLimit" > 0)
        OR "smsUsedThisPeriod" < "smsMonthlyLimit"
      )`;
  return reserved === 1;
}

/**
 * Returns one reserved unit after a SYNCHRONOUS send failure (Twilio said
 * no, or a platform switch skipped the send) — the message never left, so
 * the allowance should not stay consumed. Guarded to never go below zero:
 * if a period rollover reset the counter between the reservation and this
 * release, the release becomes a no-op rather than corrupting the new
 * period's count.
 */
export async function releaseSmsAllowance(organizationId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "OrganizationSmsSettings"
    SET "smsUsedThisPeriod" = "smsUsedThisPeriod" - 1, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "organizationId" = ${organizationId} AND "smsUsedThisPeriod" > 0`;
}
