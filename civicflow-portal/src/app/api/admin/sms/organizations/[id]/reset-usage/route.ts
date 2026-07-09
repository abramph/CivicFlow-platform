import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/** POST: resets an org's usage counter and rolls its billing period to start now. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id: organizationId } = await params;

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const settings = await prisma.organizationSmsSettings.update({
      where: { organizationId },
      data: {
        smsUsedThisPeriod: 0,
        smsBillingPeriodStart: now,
        smsBillingPeriodEnd: periodEnd,
        lastUsageThresholdNotified: 0,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.org_usage_reset",
      entityType: "OrganizationSmsSettings",
      entityId: settings.id,
    });

    return Response.json({ ok: true, data: settings });
  });
}
