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
  /** Audit justification. REQUIRED (trimmed, non-empty) whenever the request
   *  activates or deactivates the add-on; optional for ordinary settings
   *  edits (quota/plan/suspension tweaks). */
  reason: z.string().max(500).optional(),
});

/**
 * PUT: super-admin management of a single org's SMS settings — enable/
 * disable, assign a plan (STARTER/GROWTH auto-fill limits & pricing from
 * SMS_PLAN_TIERS; ENTERPRISE requires the caller to supply the numbers
 * directly, and any explicit override always wins over the plan default),
 * and suspend/unsuspend.
 *
 * ENROLLMENT SCOPE — enforced, not just documented: this endpoint may NEWLY
 * activate the add-on only for organizations with billingExempt === true
 * (they have no Stripe subscription to attach the add-on price to). For
 * every other organization, activation must go through the Stripe
 * subscription-item flow at /api/billing/sms-addon so a real line item backs
 * the entitlement; requests here are rejected. Re-sending
 * smsAddOnActive: true for an ALREADY-active org is an idempotent no-op-
 * style update (never a fresh activation), so it cannot be used to bypass
 * Stripe. This route deliberately never calls Stripe — no fake customer,
 * subscription, invoice, or line item is ever created here. Guarded by
 * requireSuperAdmin: an ordinary ORG_OWNER/ORG_ADMIN can never reach it, so
 * an org cannot grant itself an entitlement. Activation/deactivation
 * transitions require a non-empty audit reason and get their own distinct
 * audit actions carrying actor, organization, reason, and quota.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id: organizationId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    const [organization, existing] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { billingExempt: true } }),
      prisma.organizationSmsSettings.findUnique({ where: { organizationId } }),
    ]);
    if (!organization) {
      return Response.json({ ok: false, error: "Organization not found." }, { status: 404 });
    }

    const activating = input.smsAddOnActive === true && !existing?.smsAddOnActive;
    const deactivating = input.smsAddOnActive === false && existing?.smsAddOnActive === true;

    const reason = input.reason?.trim() || undefined;
    if ((activating || deactivating) && !reason) {
      throw new ValidationError(
        "A non-empty reason is required when activating or deactivating the SMS add-on."
      );
    }

    // Owner decision gate (docs/sms-overage-policy-options.md): resolved to
    // "hard_stop" (Option A), so this guard is currently inert — kept so a
    // revert of SMS_OVERAGE_POLICY to "unresolved" re-closes activation
    // everywhere, fail-safe.
    if (activating && SMS_OVERAGE_POLICY === "unresolved") {
      throw new ValidationError(
        "SMS add-on activation is temporarily unavailable until the overage billing policy is decided (docs/sms-overage-policy-options.md)."
      );
    }

    if (activating && !organization.billingExempt) {
      throw new ValidationError(
        "This endpoint can only enroll billing-exempt organizations. Paid organizations must purchase the SMS add-on through Settings → Billing so the entitlement is backed by a Stripe subscription item."
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
        reason: reason ?? null,
        billingExempt: organization.billingExempt,
        previousAddOnActive: existing?.smsAddOnActive ?? false,
        newAddOnActive: settings.smsAddOnActive,
        quota: settings.smsMonthlyLimit,
      },
    });

    return Response.json({ ok: true, data: settings });
  });
}
