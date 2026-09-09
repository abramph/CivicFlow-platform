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
  // when a webhook is delayed or missed.
  let usedThisPeriod = settings.smsUsedThisPeriod;
  const now = new Date();
  if (settings.smsBillingPeriodEnd && now > settings.smsBillingPeriodEnd) {
    const newEnd = new Date(now);
    newEnd.setMonth(newEnd.getMonth() + 1);
    await prisma.organizationSmsSettings.update({
      where: { organizationId },
      data: { smsUsedThisPeriod: 0, smsBillingPeriodStart: now, smsBillingPeriodEnd: newEnd },
    });
    usedThisPeriod = 0;
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

export async function recordSmsUsage(organizationId: string): Promise<void> {
  await prisma.organizationSmsSettings.update({
    where: { organizationId },
    data: { smsUsedThisPeriod: { increment: 1 } },
  });
}
