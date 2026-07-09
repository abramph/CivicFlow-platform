import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";

const THRESHOLDS = [50, 80, 90, 100] as const;

/**
 * Emails an org's ORG_OWNER/ORG_ADMIN users the first time its SMS usage
 * crosses 50/80/90/100% of its monthly allowance, deduping via
 * OrganizationSmsSettings.lastUsageThresholdNotified so the same threshold
 * never sends twice in one billing period (reset alongside usage in
 * reset-usage and the billing-period rollover in getSmsEntitlement).
 * No in-app notification model exists in this codebase — email via
 * lib/mail.ts is the only reusable primitive.
 */
export async function notifyOrgAdminsOfSmsUsageThresholds(): Promise<{ notified: number }> {
  const activeSettings = await prisma.organizationSmsSettings.findMany({
    where: { smsAddOnActive: true, smsMonthlyLimit: { gt: 0 } },
    select: {
      organizationId: true,
      smsMonthlyLimit: true,
      smsUsedThisPeriod: true,
      lastUsageThresholdNotified: true,
    },
  });

  let notified = 0;

  for (const settings of activeSettings) {
    const usagePercent = (settings.smsUsedThisPeriod / settings.smsMonthlyLimit) * 100;
    const crossedThreshold = [...THRESHOLDS]
      .reverse()
      .find((threshold) => usagePercent >= threshold && settings.lastUsageThresholdNotified < threshold);

    if (!crossedThreshold) continue;

    const [organization, admins] = await Promise.all([
      prisma.organization.findUnique({ where: { id: settings.organizationId }, select: { name: true } }),
      prisma.organizationMembership.findMany({
        where: { organizationId: settings.organizationId, role: { in: ["ORG_OWNER", "ORG_ADMIN"] } },
        include: { user: { select: { email: true } } },
      }),
    ]);

    const orgName = organization?.name ?? "your organization";
    const subject = `${orgName} has used ${crossedThreshold}% of its monthly SMS allowance`;
    const text = [
      `${orgName} has used ${settings.smsUsedThisPeriod} of ${settings.smsMonthlyLimit} SMS messages this billing period (${crossedThreshold}%+).`,
      crossedThreshold >= 100
        ? "Additional messages will be billed as overage."
        : "Consider reviewing usage before reaching the monthly limit.",
    ].join(" ");

    await Promise.all(admins.map((admin) => sendEmail({ to: admin.user.email, subject, text })));

    await prisma.organizationSmsSettings.update({
      where: { organizationId: settings.organizationId },
      data: { lastUsageThresholdNotified: crossedThreshold },
    });

    notified += 1;
  }

  return { notified };
}
