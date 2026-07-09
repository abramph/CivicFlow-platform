import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { SMS_PLAN_TIERS } from "@/lib/sms-admin-pricing";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  smsAddOnActive: z.boolean().optional(),
  plan: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]).optional(),
  smsMonthlyLimit: z.number().int().min(0).optional(),
  smsOverageRateCents: z.number().min(0).optional(),
  planPriceCents: z.number().int().min(0).optional(),
  suspended: z.boolean().optional(),
});

/**
 * PUT: super-admin management of a single org's SMS settings — enable/
 * disable, assign a plan (STARTER/GROWTH auto-fill limits & pricing from
 * SMS_PLAN_TIERS; ENTERPRISE requires the caller to supply the numbers
 * directly, and any explicit override always wins over the plan default),
 * and suspend/unsuspend.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id: organizationId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    const data: Record<string, unknown> = {};
    if (input.smsAddOnActive !== undefined) data.smsAddOnActive = input.smsAddOnActive;
    if (input.suspended !== undefined) data.suspendedAt = input.suspended ? new Date() : null;

    if (input.plan) {
      data.plan = input.plan;
      const tier = SMS_PLAN_TIERS[input.plan];
      if (!tier.custom) {
        data.smsMonthlyLimit = tier.includedMessages;
        data.smsOverageRateCents = tier.overageRateCents;
        data.planPriceCents = tier.monthlyPriceCents;
      }
    }
    // Explicit numeric overrides always win — required for ENTERPRISE, also allowed as an ad-hoc adjustment on any plan.
    if (input.smsMonthlyLimit !== undefined) data.smsMonthlyLimit = input.smsMonthlyLimit;
    if (input.smsOverageRateCents !== undefined) data.smsOverageRateCents = input.smsOverageRateCents;
    if (input.planPriceCents !== undefined) data.planPriceCents = input.planPriceCents;

    const settings = await prisma.organizationSmsSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.org_settings_updated",
      entityType: "OrganizationSmsSettings",
      entityId: settings.id,
      metadata: input,
    });

    return Response.json({ ok: true, data: settings });
  });
}
