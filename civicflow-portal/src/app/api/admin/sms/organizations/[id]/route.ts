import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { SMS_OVERAGE_POLICY } from "@/lib/sms-pricing";
import { SMS_MAX_MONTHLY_QUOTA } from "@/lib/sms-admin-enrollment";
import { applySmsAdminOrgSettings } from "@/lib/sms-admin-settings";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  smsAddOnActive: z.boolean().optional(),
  plan: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]).optional(),
  // Upper bound mirrors the int4 storage ceiling (SMS_MAX_MONTHLY_QUOTA) so a
  // client and this route reject an over-range/unsafe quota identically —
  // .int() also rejects decimals/non-numbers before they reach the column.
  smsMonthlyLimit: z.number().int().min(0).max(SMS_MAX_MONTHLY_QUOTA).optional(),
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
 * This handler owns AUTHORIZATION and request VALIDATION; the actual write is
 * delegated to applySmsAdminOrgSettings(), which performs the enable/disable
 * transition as a database-atomic conditional UPDATE committed together with
 * its audit event (so two concurrent requests can never both activate, double-
 * reset the period, or emit two addon_activated events).
 *
 * ENROLLMENT SCOPE — enforced, not just documented: this endpoint may NEWLY
 * activate the add-on only for organizations with billingExempt === true (they
 * have no Stripe subscription to attach the add-on price to). For every other
 * organization, activation must go through the Stripe subscription-item flow at
 * /api/billing/sms-addon; requests here are rejected. Re-sending
 * smsAddOnActive: true for an ALREADY-active org is an idempotent update (never
 * a fresh activation), so it cannot be used to bypass Stripe. This route (and
 * applySmsAdminOrgSettings) deliberately never call Stripe. Guarded by
 * requireSuperAdmin: an ordinary ORG_OWNER/ORG_ADMIN can never reach it.
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

    // Intent, from a best-effort read — used ONLY to decide which validation
    // gates apply. The authoritative activate/deactivate decision is made
    // atomically inside applySmsAdminOrgSettings via a conditional UPDATE, so a
    // request the read thinks is "activating" but that loses a concurrent race
    // is correctly downgraded to an idempotent no-op there (no extra audit).
    const wantsActivate = input.smsAddOnActive === true && !existing?.smsAddOnActive;
    const wantsDeactivate = input.smsAddOnActive === false && existing?.smsAddOnActive === true;

    const reason = input.reason?.trim() || undefined;
    if ((wantsActivate || wantsDeactivate) && !reason) {
      throw new ValidationError("A non-empty reason is required when activating or deactivating the SMS add-on.");
    }

    // Owner decision gate (docs/sms-overage-policy-options.md): resolved to
    // "hard_stop" (Option A), so this guard is currently inert — kept so a
    // revert of SMS_OVERAGE_POLICY to "unresolved" re-closes activation
    // everywhere, fail-safe.
    if (wantsActivate && SMS_OVERAGE_POLICY === "unresolved") {
      throw new ValidationError(
        "SMS add-on activation is temporarily unavailable until the overage billing policy is decided (docs/sms-overage-policy-options.md)."
      );
    }

    if (wantsActivate && !organization.billingExempt) {
      throw new ValidationError(
        "This endpoint can only enroll billing-exempt organizations. Paid organizations must purchase the SMS add-on through Settings → Billing so the entitlement is backed by a Stripe subscription item."
      );
    }

    if (wantsActivate) {
      // An activation must yield a usable allowance — a zero/absent quota
      // would create an entitlement that hard-stops on its very first send.
      const effectiveLimit = input.smsMonthlyLimit ?? existing?.smsMonthlyLimit ?? 0;
      if (effectiveLimit <= 0) {
        throw new ValidationError(
          "Activation requires a positive monthly quota — choose a plan or set smsMonthlyLimit."
        );
      }
    }

    const { settings } = await applySmsAdminOrgSettings({
      organizationId,
      input,
      reason: reason ?? null,
      billingExempt: organization.billingExempt,
      actor: { userId: session.userId, userEmail: session.userEmail },
    });

    // Never expose a Stripe identifier in the API response — the admin UI
    // doesn't use it, and it must not leak to any client. `undefined` values
    // are dropped by JSON serialization, so the key is absent from the body.
    return Response.json({ ok: true, data: { ...settings, stripeSmsSubscriptionItemId: undefined } });
  });
}
