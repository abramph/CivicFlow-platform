import { prisma } from "@/lib/prisma";
import { getPlatformWhatsAppSettings } from "@/lib/whatsapp/credentials";

export interface WhatsAppEntitlement {
  allowed: boolean;
  reason?: string;
  remaining: number;
  limit: number;
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * The single source of truth for "can this org send WhatsApp right now" —
 * mirrors getSmsEntitlement() exactly: always recomputed live from
 * OrganizationWhatsAppSettings.whatsappAddOnActive plus the org's current
 * Subscription.status. Never trust a cached flag for this. No org has a row
 * in OrganizationWhatsAppSettings until a platform administrator explicitly
 * creates one — so every organization is denied by default until that
 * happens, which won't occur before PR B/D ship the admin action to do it.
 */
export async function getWhatsAppEntitlement(organizationId: string): Promise<WhatsAppEntitlement> {
  const [settings, subscription, platformSettings] = await Promise.all([
    prisma.organizationWhatsAppSettings.findUnique({ where: { organizationId } }),
    prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      select: { status: true },
    }),
    getPlatformWhatsAppSettings(),
  ]);

  if (!platformSettings.orgMessagingEnabled) {
    return {
      allowed: false,
      reason: "Organization WhatsApp messaging is currently disabled platform-wide.",
      remaining: 0,
      limit: 0,
    };
  }

  if (!settings || !settings.whatsappAddOnActive) {
    return {
      allowed: false,
      reason: "Your organization does not have the WhatsApp add-on enabled.",
      remaining: 0,
      limit: 0,
    };
  }

  if (settings.suspendedAt) {
    return {
      allowed: false,
      reason: "WhatsApp messaging has been suspended for your organization by a platform administrator.",
      remaining: 0,
      limit: settings.whatsappMonthlyLimit,
    };
  }

  if (!subscription || !ACTIVE_STATUSES.has(subscription.status)) {
    return {
      allowed: false,
      reason: "Your organization's subscription is not active.",
      remaining: 0,
      limit: settings.whatsappMonthlyLimit,
    };
  }

  // Lazily roll the billing period forward if it has elapsed — mirrors
  // getSmsEntitlement()'s own backup-for-a-missed-webhook rollover.
  let usedThisPeriod = settings.whatsappUsedThisPeriod;
  const now = new Date();
  if (settings.whatsappBillingPeriodEnd && now > settings.whatsappBillingPeriodEnd) {
    const newEnd = new Date(now);
    newEnd.setMonth(newEnd.getMonth() + 1);
    await prisma.organizationWhatsAppSettings.update({
      where: { organizationId },
      data: { whatsappUsedThisPeriod: 0, whatsappBillingPeriodStart: now, whatsappBillingPeriodEnd: newEnd },
    });
    usedThisPeriod = 0;
  }

  // Overage is a soft cap, same deliberate policy as SMS: exceeding the
  // monthly limit doesn't block sending — it's tracked for future invoicing.
  return {
    allowed: true,
    remaining: settings.whatsappMonthlyLimit - usedThisPeriod,
    limit: settings.whatsappMonthlyLimit,
  };
}

export async function recordWhatsAppUsage(organizationId: string): Promise<void> {
  await prisma.organizationWhatsAppSettings.update({
    where: { organizationId },
    data: { whatsappUsedThisPeriod: { increment: 1 } },
  });
}
