import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { getMaskedWhatsAppSettingsView, getPlatformWhatsAppSettings, updatePlatformWhatsAppSettings } from "@/lib/whatsapp/credentials";
import { parseJsonBody, z } from "@/lib/validation";

/** GET: platform status, global toggles, and masked sender identity for the WhatsApp Administration dashboard. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireSuperAdmin("throw");
    const view = await getMaskedWhatsAppSettingsView();
    return Response.json({ ok: true, data: view });
  });
}

const bodySchema = z.object({
  fromNumber: z.string().nullable().optional(),
  messagingServiceSid: z.string().nullable().optional(),
  platformEnabled: z.boolean().optional(),
  sandboxMode: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  outboundPaused: z.boolean().optional(),
  orgMessagingEnabled: z.boolean().optional(),
  testPhoneNumbers: z.array(z.string()).optional(),
});

/** PUT: updates the sender identity and/or global control toggles. Every change is audited; secrets never appear in the audit metadata (only which fields changed). */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const input = await parseJsonBody(request, bodySchema);

    await updatePlatformWhatsAppSettings(input, session.userId);
    const settings = await getPlatformWhatsAppSettings();

    await createAuditEvent({
      organizationId: null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "whatsapp_admin.settings_updated",
      entityType: "PlatformWhatsAppSettings",
      entityId: settings.id,
      metadata: { fields: Object.keys(input) },
    });

    const view = await getMaskedWhatsAppSettingsView();
    return Response.json({ ok: true, data: view });
  });
}
