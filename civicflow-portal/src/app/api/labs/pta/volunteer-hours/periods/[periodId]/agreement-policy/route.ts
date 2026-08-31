import { PERMISSIONS } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { updateAgreementPolicy } from "@/lib/labs/pta/volunteer-hours/agreements";
import { parseJsonBody, z } from "@/lib/validation";

const policySchema = z
  .object({
    agreementRequired: z.boolean(),
    agreementVersionId: z.string().min(1).nullable(),
    contractLinkedBuyoutEnabled: z.boolean(),
    contractLinkedEligibilityDays: z.number().int().positive().nullable(),
    contractLinkedUsesAcceptanceRate: z.boolean(),
  })
  .strict();

/**
 * Gated on `pta:volunteer-buyout-pricing:manage` — deliberately the
 * STRICTER (FINANCE-level) permission for this whole endpoint, even though
 * `agreementRequired`/`agreementVersionId` alone are requirements-adjacent.
 * This route is the single write path for every agreement/contract-linked
 * buyout POLICY field together (see updateAgreementPolicy's own doc
 * comment on why they're not split into two calls), and contract-linked
 * buyout config is inescapably a pricing decision — the whole endpoint
 * inherits its permission from the more sensitive half.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE, "buyout");
    const { periodId } = await params;
    const input = await parseJsonBody(request, policySchema);
    const updated = await updateAgreementPolicy(organizationId, periodId, input, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: updated });
  });
}
