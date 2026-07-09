import { prisma } from "@/lib/prisma";
import { getPlatformSmsSettings } from "@/lib/sms-credentials";

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
  const [settings, subscription, platformSettings] = await Promise.all([
    prisma.organizationSmsSettings.findUnique({ where: { organizationId } }),
    prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    }),
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

  if (!subscription || !ACTIVE_STATUSES.has(subscription.status)) {
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

  // Overage is a soft cap: exceeding the monthly limit doesn't block sending
  // — it's tracked for future invoicing at smsOverageRateCents/message, per
  // the add-on's own overage pricing. This is a deliberate policy choice.
  return { allowed: true, remaining: settings.smsMonthlyLimit - usedThisPeriod, limit: settings.smsMonthlyLimit };
}

export async function recordSmsUsage(organizationId: string): Promise<void> {
  await prisma.organizationSmsSettings.update({
    where: { organizationId },
    data: { smsUsedThisPeriod: { increment: 1 } },
  });
}
