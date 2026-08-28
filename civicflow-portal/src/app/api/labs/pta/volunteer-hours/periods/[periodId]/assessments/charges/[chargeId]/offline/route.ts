import { withApiErrorHandling } from "@/lib/api-route";
import { recordOfflineVolunteerAssessmentPayment } from "@/lib/labs/pta/volunteer-hours/assessment-payments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  paymentMethod: z.enum(["CASH", "CHECK", "ZELLE", "CASH_APP", "OTHER"]),
  reference: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ chargeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-payments:record-offline", "assessments");
    const { chargeId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const charge = await recordOfflineVolunteerAssessmentPayment(organizationId, chargeId, input, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: charge });
  });
}
