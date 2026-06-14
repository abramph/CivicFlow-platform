import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { postPaymentImportItem } from "@/lib/payment-reconciliation";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  itemId: z.string().min(1),
  postedAs: z.enum(["DUES_PAYMENT", "CONTRIBUTION"]),
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  duesChargeId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  campaignId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  eventId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  receiptRequested: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, postSchema);
    const result = await postPaymentImportItem({
      organizationId,
      itemId: input.itemId,
      postedAs: input.postedAs,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      memberId: input.memberId || null,
      duesChargeId: input.duesChargeId || null,
      campaignId: input.campaignId || null,
      eventId: input.eventId || null,
      receiptRequested: input.receiptRequested,
    });
    return Response.json({ ok: true, data: result });
  });
}
