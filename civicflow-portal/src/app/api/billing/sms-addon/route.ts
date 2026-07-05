import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { addSmsAddOnToSubscription, removeSmsAddOnFromSubscription } from "@/lib/stripe";
import { SMS_ADDON } from "@/lib/sms-pricing";
import { ValidationError } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("billing:read", "throw");
    const settings = await prisma.organizationSmsSettings.findUnique({ where: { organizationId } });

    return Response.json({
      ok: true,
      data: {
        smsAddOnActive: settings?.smsAddOnActive ?? false,
        smsMonthlyLimit: settings?.smsMonthlyLimit ?? 0,
        smsUsedThisPeriod: settings?.smsUsedThisPeriod ?? 0,
        smsOverageRateCents: settings?.smsOverageRateCents ?? SMS_ADDON.overageRateCents,
        smsBillingPeriodEnd: settings?.smsBillingPeriodEnd ?? null,
        monthlyPriceCents: SMS_ADDON.monthlyPriceCents,
      },
    });
  });
}

export async function POST() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("billing:manage", "throw");

    const subscription = await prisma.subscription.findFirst({
      where: { organizationId, status: { in: ["active", "trialing", "past_due"] } },
      orderBy: { updatedAt: "desc" },
    });

    if (!subscription?.stripeSubscriptionId) {
      throw new ValidationError("Subscribe to a paid plan before adding the SMS add-on.");
    }

    const existing = await prisma.organizationSmsSettings.findUnique({ where: { organizationId } });
    if (existing?.smsAddOnActive) {
      throw new ValidationError("The SMS add-on is already enabled.");
    }

    const { subscriptionItemId } = await addSmsAddOnToSubscription(subscription.stripeSubscriptionId);
    const now = new Date();

    await prisma.organizationSmsSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        smsAddOnActive: true,
        smsMonthlyLimit: SMS_ADDON.includedMessagesPerMonth,
        smsOverageRateCents: SMS_ADDON.overageRateCents,
        smsBillingPeriodStart: subscription.currentPeriodStart ?? now,
        smsBillingPeriodEnd: subscription.currentPeriodEnd ?? new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()),
        stripeSmsSubscriptionItemId: subscriptionItemId,
      },
      update: {
        smsAddOnActive: true,
        smsMonthlyLimit: SMS_ADDON.includedMessagesPerMonth,
        stripeSmsSubscriptionItemId: subscriptionItemId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "organization_sms_settings",
      entityId: organizationId,
      metadata: { action: "enable_sms_addon" },
    });

    return Response.json({ ok: true });
  });
}

export async function DELETE() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("billing:manage", "throw");

    const settings = await prisma.organizationSmsSettings.findUnique({ where: { organizationId } });
    if (!settings?.smsAddOnActive || !settings.stripeSmsSubscriptionItemId) {
      throw new ValidationError("The SMS add-on is not currently enabled.");
    }

    await removeSmsAddOnFromSubscription(settings.stripeSmsSubscriptionItemId);

    await prisma.organizationSmsSettings.update({
      where: { organizationId },
      data: { smsAddOnActive: false, stripeSmsSubscriptionItemId: null },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "organization_sms_settings",
      entityId: organizationId,
      metadata: { action: "disable_sms_addon" },
    });

    return Response.json({ ok: true });
  });
}
