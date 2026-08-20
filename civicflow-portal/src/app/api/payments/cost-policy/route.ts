import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { COST_POLICY_VERSION } from "@/lib/payments/cost-policy";

/**
 * COST-POLICY v2 (§6) — organization payment-cost policy. Held to the same
 * financial-configuration authority as the giving settings (funds-manage):
 * choosing who bears processing costs is a financial-administration act,
 * audited with previous/new values (§13).
 *
 * What an administrator can NOT do here, by construction: override card-
 * network or technical eligibility. There is no field for it — mandatory
 * coverage activates only when the platform-level eligibility mechanism
 * exists (global flags, see cost-policy.ts), never per-org fiat.
 */

const POLICY_SELECT = {
  paymentCostPolicyV2Enabled: true,
  fixedObligationCoveragePolicy: true,
  voluntaryCoveragePolicy: true,
  ineligiblePaymentMethodFallback: true,
  achEnabled: true,
  policyAcceptedAt: true,
  policyAcceptedByUserId: true,
  policyVersion: true,
} as const;

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:summary:view", "throw");
    const settings = await prisma.orgSettings.findUnique({ where: { organizationId }, select: POLICY_SELECT });
    return Response.json({ ok: true, data: { ...settings, currentPolicyVersion: COST_POLICY_VERSION } });
  });
}

const putSchema = z.object({
  paymentCostPolicyV2Enabled: z.boolean().optional(),
  fixedObligationCoveragePolicy: z.enum(["REQUIRED_WHERE_PERMITTED", "ORGANIZATION_ABSORBS"]).optional(),
  voluntaryCoveragePolicy: z.enum(["OPTIONAL", "ORGANIZATION_ABSORBS"]).optional(),
  ineligiblePaymentMethodFallback: z.enum(["ORGANIZATION_ABSORBS", "REQUIRE_ACH", "OFFER_ALTERNATIVES"]).optional(),
  achEnabled: z.boolean().optional(),
  /** §6 acknowledgment: the caller affirms the merchant-of-record,
   * surcharge-variability, debit/prepaid, lawful-policy, and
   * Unestra-may-prevent-ineligible-fees terms. Recorded, never implied. */
  acceptPolicy: z.boolean().optional(),
});

export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:funds:manage", "throw");
    const input = await parseJsonBody(request, putSchema);

    const existing = await prisma.orgSettings.findUnique({ where: { organizationId }, select: POLICY_SELECT });
    if (!existing) throw new ValidationError("Organization settings not found.");

    const wantsRequired =
      (input.fixedObligationCoveragePolicy ?? existing.fixedObligationCoveragePolicy) === "REQUIRED_WHERE_PERMITTED";
    const willHaveAcceptance = Boolean(existing.policyAcceptedAt) || input.acceptPolicy === true;
    if (wantsRequired && !willHaveAcceptance) {
      return Response.json(
        {
          ok: false,
          error:
            "Selecting required cost coverage needs the administrator acknowledgment first (acceptPolicy: true).",
        },
        { status: 409 }
      );
    }

    const data: Record<string, unknown> = {};
    for (const key of [
      "paymentCostPolicyV2Enabled",
      "fixedObligationCoveragePolicy",
      "voluntaryCoveragePolicy",
      "ineligiblePaymentMethodFallback",
      "achEnabled",
    ] as const) {
      if (input[key] !== undefined) data[key] = input[key];
    }
    if (input.acceptPolicy === true && !existing.policyAcceptedAt) {
      data.policyAcceptedAt = new Date();
      data.policyAcceptedByUserId = session.userId;
      data.policyVersion = COST_POLICY_VERSION;
    }

    const updated = await prisma.orgSettings.update({
      where: { organizationId },
      data,
      select: POLICY_SELECT,
    });

    // §13: previous value, new value, actor, policy version — every change.
    await createAuditEvent({
      organizationId,
      action: "update",
      entityType: "payment_cost_policy",
      entityId: organizationId,
      metadata: {
        actorUserId: session.userId,
        previous: existing,
        next: updated,
        policyVersion: updated.policyVersion ?? COST_POLICY_VERSION,
        acknowledged: input.acceptPolicy === true,
      },
    });

    return Response.json({ ok: true, data: { ...updated, currentPolicyVersion: COST_POLICY_VERSION } });
  });
}
