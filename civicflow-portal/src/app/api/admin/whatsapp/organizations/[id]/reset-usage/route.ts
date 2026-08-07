import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/** POST: resets an org's WhatsApp usage counter and rolls its billing period to start now. Mirrors the SMS equivalent exactly. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id: organizationId } = await params;

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const settings = await prisma.organizationWhatsAppSettings.update({
      where: { organizationId },
      data: {
        whatsappUsedThisPeriod: 0,
        whatsappBillingPeriodStart: now,
        whatsappBillingPeriodEnd: periodEnd,
        lastUsageThresholdNotified: 0,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "whatsapp_admin.org_usage_reset",
      entityType: "OrganizationWhatsAppSettings",
      entityId: settings.id,
    });

    return Response.json({ ok: true, data: settings });
  });
}
