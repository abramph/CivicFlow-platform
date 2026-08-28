import { withApiErrorHandling } from "@/lib/api-route";
import { refundPurchasedHours } from "@/lib/labs/pta/volunteer-hours/corrections";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  refundMinutes: z.number().int().min(1).max(100_000),
  refundAmountCents: z.number().int().min(1).max(10_000_000),
  reason: z.string().min(1).max(2000),
});

export async function POST(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-payments:refund", "buyout");
    const { purchaseId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const result = await refundPurchasedHours(organizationId, purchaseId, input, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: result });
  });
}
