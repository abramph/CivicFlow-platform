import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getMaskedSmsCredentialsView, getPlatformSmsSettings } from "@/lib/sms-credentials";
import { parseJsonBody, z } from "@/lib/validation";

/** GET: platform status, global toggles, and masked credentials for the SMS Administration dashboard. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireSuperAdmin("throw");

    const [settings, credentials] = await Promise.all([getPlatformSmsSettings(), getMaskedSmsCredentialsView()]);

    return Response.json({
      ok: true,
      data: {
        platformEnabled: settings.platformEnabled,
        testMode: settings.testMode,
        maintenanceMode: settings.maintenanceMode,
        outboundPaused: settings.outboundPaused,
        mfaSmsEnabled: settings.mfaSmsEnabled,
        orgMessagingEnabled: settings.orgMessagingEnabled,
        testPhoneNumbers: settings.testPhoneNumbers,
        carrierFeePercent: settings.carrierFeePercent,
        tollFreeVerificationStatus: settings.tollFreeVerificationStatus,
        tollFreeVerificationSubmittedAt: settings.tollFreeVerificationSubmittedAt,
        tollFreeVerificationApprovedAt: settings.tollFreeVerificationApprovedAt,
        tollFreeVerificationLastCheckedAt: settings.tollFreeVerificationLastCheckedAt,
        credentials,
      },
    });
  });
}

const bodySchema = z.object({
  platformEnabled: z.boolean().optional(),
  testMode: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  outboundPaused: z.boolean().optional(),
  mfaSmsEnabled: z.boolean().optional(),
  orgMessagingEnabled: z.boolean().optional(),
  testPhoneNumbers: z.array(z.string()).optional(),
  carrierFeePercent: z.number().int().min(0).max(100).optional(),
});

/** PUT: updates the global control toggles. Every change is audited. */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const input = await parseJsonBody(request, bodySchema);

    const settings = await getPlatformSmsSettings();
    const updated = await prisma.platformSmsSettings.update({
      where: { id: settings.id },
      data: { ...input, updatedByUserId: session.userId },
    });

    await createAuditEvent({
      organizationId: null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.settings_updated",
      entityType: "PlatformSmsSettings",
      entityId: settings.id,
      metadata: input,
    });

    return Response.json({
      ok: true,
      data: {
        platformEnabled: updated.platformEnabled,
        testMode: updated.testMode,
        maintenanceMode: updated.maintenanceMode,
        outboundPaused: updated.outboundPaused,
        mfaSmsEnabled: updated.mfaSmsEnabled,
        orgMessagingEnabled: updated.orgMessagingEnabled,
        testPhoneNumbers: updated.testPhoneNumbers,
        carrierFeePercent: updated.carrierFeePercent,
      },
    });
  });
}
