import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { waivePtaDuesCharge } from "@/lib/labs/pta/dues";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ reason: z.string().nullable().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ householdId: string; chargeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:dues:manage");
    const { householdId, chargeId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const charge = await waivePtaDuesCharge(organizationId, householdId, chargeId, input.reason ?? null, session.userId, session.userEmail);
    return Response.json({ ok: true, data: charge });
  });
}
