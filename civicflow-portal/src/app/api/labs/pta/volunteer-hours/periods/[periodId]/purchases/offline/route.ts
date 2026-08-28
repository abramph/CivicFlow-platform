import { withApiErrorHandling } from "@/lib/api-route";
import { recordOfflineVolunteerBuyoutPurchase } from "@/lib/labs/pta/volunteer-hours/purchases";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  householdId: z.string().min(1),
  electionId: z.string().min(1).nullable().optional(),
  electionType: z.enum(["FULL_BUYOUT", "PARTIAL_BUYOUT"]),
  hoursElectedMinutes: z.number().int().min(1).max(100_000).optional(),
  paymentMethod: z.enum(["CASH", "CHECK", "ZELLE", "CASH_APP", "OTHER"]),
  reference: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** POST /api/labs/pta/volunteer-hours/periods/:id/purchases/offline — an
 * authorized administrator records a cash/check/Zelle/CashApp/other
 * payment. Purchased-hour credit posts immediately since this route IS the
 * verification step (spec §7: "after an authorized administrator records
 * and verifies an approved offline payment"). */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-payments:record-offline", "buyout");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const purchase = await recordOfflineVolunteerBuyoutPurchase(organizationId, periodId, input.householdId, input, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: purchase }, { status: 201 });
  });
}
