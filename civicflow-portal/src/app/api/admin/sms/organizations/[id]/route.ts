import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { SMS_PLAN_TIERS } from "@/lib/sms-admin-pricing";
import { SMS_OVERAGE_POLICY } from "@/lib/sms-pricing";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  smsAddOnActive: z.boolean().optional(),
  plan: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]).optional(),
  smsMonthlyLimit: z.number().int().min(0).optional(),
  smsOverageRateCents: z.number().min(0).optional(),
  planPriceCents: z.number().int().min(0).optional(),
  suspended: z.boolean().optional(),
  /** Free-text justification recorded in the audit event — required practice
   *  for billing-exempt enrollments, optional elsewhere. */
  reason: z.string().max(500).optional(),
});

/**
 * PUT: super-admin management of a single org's SMS settings — enable/
 * disable, assign a plan (STARTER/GROWTH auto-fill limits & pricing from
 * SMS_PLAN_TIERS; ENTERPRISE requires the caller to supply the numbers
 * directly, and any explicit override always wins over the plan default),
 * and suspend/unsuspend.
 *
 * This is the ONLY supported enrollment path for billing-exempt
 * organizations (they have no Stripe subscription to attach the add-on
 * price to, and this endpoint deliberately never touches Stripe — no fake
 * customer/subscription/invoice is created). Paid organizations keep using
 * the Stripe subscription-item flow in /api/billing/sms-addon. Guarded by
 * requireSuperAdmin: an ordinary ORG_OWNER/ORG_ADMIN can never reach it, so
 * an org cannot grant itself an exempt entitlement. Activation/deactivation
 * transitions get their own distinct audit actions carrying actor,
 * organization, reason, and quota.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id: organizationId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    const existing = await prisma.organizationSmsSettings.findUnique({ where: { organizationId } });
    const activating = input.smsAddOnActive === true && !existing?.smsAddOnActive;
    const deactivating = input.smsAddOnActive === false && existing?.smsAddOnActive === true;

    // Owner decision gate (docs/sms-overage-policy-options.md): while the
    // overage-billing policy is unresolved, no NEW activation is allowed
    // through any path — the advertised $0.02/message overage is currently
    // metered but not invoiced. Deactivation and non-activation edits
    // (quota, suspension, plan) remain available.
    if (activating && SMS_OVERAGE_POLICY === "unresolved") {
      throw new ValidationError(
        "SMS add-on activation is temporarily unavailable until the overage billing policy is decided (docs/sms-overage-policy-options.md)."
      );
    }

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
      action: activating
        ? "sms_admin.addon_activated"
        : deactivating
          ? "sms_admin.addon_deactivated"
          : "sms_admin.org_settings_updated",
      entityType: "OrganizationSmsSettings",
      entityId: settings.id,
      metadata: {
        ...input,
        reason: input.reason ?? null,
        previousAddOnActive: existing?.smsAddOnActive ?? false,
        newAddOnActive: settings.smsAddOnActive,
        quota: settings.smsMonthlyLimit,
      },
    });

    return Response.json({ ok: true, data: settings });
  });
}
