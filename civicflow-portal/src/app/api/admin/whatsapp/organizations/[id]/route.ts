import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { WHATSAPP_ADDON } from "@/lib/whatsapp/pricing";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  whatsappAddOnActive: z.boolean().optional(),
  whatsappMonthlyLimit: z.number().int().min(0).optional(),
  whatsappOverageRateCents: z.number().min(0).optional(),
  suspended: z.boolean().optional(),
  pilotMode: z.boolean().optional(),
  paused: z.boolean().optional(),
  pauseReason: z.string().nullable().optional(),
  quietHoursStartHour: z.number().int().min(0).max(23).optional(),
  quietHoursEndHour: z.number().int().min(0).max(23).optional(),
});

/**
 * PUT: super-admin management of a single org's WhatsApp settings —
 * mirrors PUT /api/admin/sms/organizations/[id]/route.ts, minus plan-tier
 * logic (PR D's flat-pricing scope decision — no WhatsApp plan tiers), plus
 * pilotMode/paused-with-reason/quiet-hours, which SMS doesn't have. First
 * activation (whatsappAddOnActive flips false -> true) with no monthly
 * limit set yet default-fills from the single WHATSAPP_ADDON constant,
 * mirroring how SMS's STARTER/GROWTH tiers auto-fill limits on assignment
 * — explicit numeric overrides in the same request always win.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id: organizationId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    const existing = await prisma.organizationWhatsAppSettings.findUnique({ where: { organizationId } });

    const data: Record<string, unknown> = {};
    if (input.whatsappAddOnActive !== undefined) {
      data.whatsappAddOnActive = input.whatsappAddOnActive;
      const activatingForFirstTime = input.whatsappAddOnActive && !existing?.whatsappAddOnActive;
      if (activatingForFirstTime && !existing?.whatsappMonthlyLimit) {
        data.whatsappMonthlyLimit = WHATSAPP_ADDON.includedMessagesPerMonth;
        data.whatsappOverageRateCents = WHATSAPP_ADDON.overageRateCents;
      }
    }
    if (input.suspended !== undefined) data.suspendedAt = input.suspended ? new Date() : null;
    if (input.pilotMode !== undefined) data.pilotMode = input.pilotMode;
    if (input.paused !== undefined) {
      data.pausedAt = input.paused ? new Date() : null;
      if (!input.paused) data.pauseReason = null;
    }
    if (input.pauseReason !== undefined) data.pauseReason = input.pauseReason;
    if (input.quietHoursStartHour !== undefined) data.quietHoursStartHour = input.quietHoursStartHour;
    if (input.quietHoursEndHour !== undefined) data.quietHoursEndHour = input.quietHoursEndHour;
    // Explicit numeric overrides always win over the activation default-fill above.
    if (input.whatsappMonthlyLimit !== undefined) data.whatsappMonthlyLimit = input.whatsappMonthlyLimit;
    if (input.whatsappOverageRateCents !== undefined) data.whatsappOverageRateCents = input.whatsappOverageRateCents;

    const settings = await prisma.organizationWhatsAppSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "whatsapp_admin.org_settings_updated",
      entityType: "OrganizationWhatsAppSettings",
      entityId: settings.id,
      metadata: input,
    });

    return Response.json({ ok: true, data: settings });
  });
}
