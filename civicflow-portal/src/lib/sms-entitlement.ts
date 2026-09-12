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
  // reserveSmsAllowance's own atomic rollover) can never double-reset the
  // counter: the loser's where-clause simply matches nothing. A loser must
  // NOT keep the stale pre-rollover usage it read (at the boundary that
  // could falsely deny a send whose capacity the winner just refreshed) —
  // it refetches the post-rollover truth instead. Either way this remains a
  // pre-check for good error messages; reserveSmsAllowance below is the
  // sole final quota authority immediately before Twilio.
  let usedThisPeriod = settings.smsUsedThisPeriod;
  const now = new Date();
  if (settings.smsBillingPeriodEnd && now > settings.smsBillingPeriodEnd) {
    const newEnd = new Date(now);
    newEnd.setMonth(newEnd.getMonth() + 1);
    const rolled = await prisma.organizationSmsSettings.updateMany({
      where: { organizationId, smsBillingPeriodEnd: settings.smsBillingPeriodEnd },
      data: { smsUsedThisPeriod: 0, smsBillingPeriodStart: now, smsBillingPeriodEnd: newEnd },
    });
    if (rolled.count === 1) {
      usedThisPeriod = 0;
    } else {
      const fresh = await prisma.organizationSmsSettings.findUnique({
        where: { organizationId },
        select: { smsUsedThisPeriod: true },
      });
      usedThisPeriod = fresh?.smsUsedThisPeriod ?? usedThisPeriod;
    }
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
 * Opaque proof of one successfully reserved allowance unit, bound to the
 * EXACT billing period the unit was counted in (the post-update period
 * values returned by the reservation's own UPDATE). releaseSmsAllowance
 * only ever decrements a row whose organization AND period still match this
 * token — so a stale release from before a rollover (or a webhook period
 * reconciliation) affects zero rows instead of erasing a unit that a NEWER
 * period's successful send legitimately consumed.
 */
export interface SmsAllowanceReservation {
  organizationId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
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
 * exactly R reservations succeed and the rest observe zero matched rows and
 * fail closed. The same statement atomically handles an elapsed billing
 * period (reset-and-claim as unit #1 of the new period), so rollover can
 * never race a reservation into an over- or under-count. A row whose period
 * columns are NULL (legacy/manually-created enrollment predating the
 * activation-time period initialization) is treated exactly like an elapsed
 * period: defensively initialized to a fresh month and claimed as unit #1 —
 * never reserved against indefinitely with no rollover, and never allowed
 * to oversubscribe (a zero limit still refuses).
 *
 * Returns an SmsAllowanceReservation naming the period actually charged
 * (RETURNING the post-update values), or null when nothing could be
 * reserved. Callers must pass that token back to releaseSmsAllowance on a
 * synchronous failure.
 *
 * Fail-closed tradeoff, documented deliberately: a crash between a
 * successful reservation and the Twilio call permanently consumes that unit
 * (the send never happened, the counter says it did). We accept losing a
 * unit of capacity over any risk of an over-quota send — undoing it safely
 * would require a per-message reservation ledger (schema change), which the
 * owner has not authorized.
 *
 * NOTE for a future "metered_overage" policy: this reservation enforces the
 * hard stop by construction; Option B would need a different claim rule.
 */
export async function reserveSmsAllowance(organizationId: string): Promise<SmsAllowanceReservation | null> {
  // Timestamp columns are Prisma DateTime → `timestamp(3)` WITHOUT time
  // zone, storing UTC wall-clock values. Comparing them against bare NOW()
  // (a timestamptz) makes Postgres interpret the stored naive value in the
  // SESSION time zone — off by the server's UTC offset on any non-UTC
  // server. `NOW() AT TIME ZONE 'UTC'` yields the naive-UTC "now" that
  // matches Prisma's storage convention (caught by
  // sms-quota-reservation.integration.test.ts on a non-UTC dev server).
  const rows = await prisma.$queryRaw<Array<{ periodStart: Date | null; periodEnd: Date | null }>>`
    UPDATE "OrganizationSmsSettings"
    SET
      "smsUsedThisPeriod" = CASE
        WHEN "smsBillingPeriodEnd" IS NULL OR "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC') THEN 1
        ELSE "smsUsedThisPeriod" + 1
      END,
      "smsBillingPeriodStart" = CASE
        WHEN "smsBillingPeriodEnd" IS NULL OR "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC') THEN (NOW() AT TIME ZONE 'UTC')
        ELSE "smsBillingPeriodStart"
      END,
      "smsBillingPeriodEnd" = CASE
        WHEN "smsBillingPeriodEnd" IS NULL OR "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC') THEN (NOW() AT TIME ZONE 'UTC') + interval '1 month'
        ELSE "smsBillingPeriodEnd"
      END,
      "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "organizationId" = ${organizationId}
      AND (
        (("smsBillingPeriodEnd" IS NULL OR "smsBillingPeriodEnd" < (NOW() AT TIME ZONE 'UTC')) AND "smsMonthlyLimit" > 0)
        OR "smsUsedThisPeriod" < "smsMonthlyLimit"
      )
    RETURNING "smsBillingPeriodStart" AS "periodStart", "smsBillingPeriodEnd" AS "periodEnd"`;
  if (rows.length !== 1) return null;
  return { organizationId, periodStart: rows[0].periodStart, periodEnd: rows[0].periodEnd };
}

/**
 * Returns one reserved unit after a SYNCHRONOUS send failure (Twilio said
 * no, or a platform switch skipped the send) — the message never left, so
 * the allowance should not stay consumed. Period-safe by construction: the
 * decrement matches the organization AND the exact billing period recorded
 * in the reservation token (IS NOT DISTINCT FROM, so NULL periods compare
 * too). If a rollover or webhook reconciliation replaced the period between
 * reservation and release, zero rows match and nothing is decremented — a
 * stale old-period release can never erase a newer period's successful send
 * or reopen capacity it isn't entitled to. Floor-guarded at zero as before.
 *
 * The period comparison is done in epoch MILLISECONDS on both sides, not by
 * binding the Dates directly: the columns are naive-UTC timestamp(3), and a
 * bound Date parameter is interpreted through the server session time zone,
 * which silently mismatches on any non-UTC server (the integration suite
 * caught a matching release affecting zero rows exactly this way).
 * `extract(epoch from <naive timestamp>)` applies no time-zone conversion,
 * so it recovers the same UTC epoch that Date#getTime() carries.
 *
 * NOTE the token is deliberately NOT per-attempt (it carries no message
 * identity), so this function alone is not idempotent — calling it twice
 * for the same failed attempt would decrement twice. The exactly-once
 * guarantee lives in finalizeSmsAttemptFailure
 * (lib/sms-attempt-finalization.ts), which is the ONLY caller and invokes
 * this inside the same transaction as the attempt's single winning
 * FAILED transition. Do not call this from anywhere else. The optional
 * `db` parameter exists precisely so that finalizer can pass its
 * transaction client.
 */
export async function releaseSmsAllowance(
  reservation: SmsAllowanceReservation,
  db: { $executeRaw: typeof prisma.$executeRaw } = prisma
): Promise<void> {
  const periodStartMs = reservation.periodStart ? BigInt(reservation.periodStart.getTime()) : null;
  const periodEndMs = reservation.periodEnd ? BigInt(reservation.periodEnd.getTime()) : null;
  await db.$executeRaw`
    UPDATE "OrganizationSmsSettings"
    SET "smsUsedThisPeriod" = "smsUsedThisPeriod" - 1, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "organizationId" = ${reservation.organizationId}
      AND "smsUsedThisPeriod" > 0
      AND (extract(epoch from "smsBillingPeriodStart") * 1000)::bigint IS NOT DISTINCT FROM ${periodStartMs}
      AND (extract(epoch from "smsBillingPeriodEnd") * 1000)::bigint IS NOT DISTINCT FROM ${periodEndMs}`;
}
