import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { recordManualPtaDuesPayment } from "@/lib/labs/pta/dues";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  amountCents: z.number().int().positive(),
  method: z.enum(["CASH", "CHECK", "CREDIT_CARD", "DEBIT_CARD", "CARD", "ACH", "ZELLE", "CASH_APP", "VENMO", "PAYPAL", "STRIPE", "ZEFFY", "OTHER"]),
  paymentDate: z.coerce.date(),
  reference: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ householdId: string; chargeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:dues:manage");
    const { householdId, chargeId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const payment = await recordManualPtaDuesPayment({ organizationId, householdId, duesChargeId: chargeId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: payment });
  });
}
