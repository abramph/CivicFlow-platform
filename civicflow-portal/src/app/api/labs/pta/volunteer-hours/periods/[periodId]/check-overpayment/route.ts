import { withApiErrorHandling } from "@/lib/api-route";
import { checkForOverpaymentAfterRequirementChange } from "@/lib/labs/pta/volunteer-hours/corrections";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ householdId: z.string().min(1) });

/** POST — call after reducing a family's requirement (a VH-B assignment
 * edit) to check whether they now have excess purchased/verified hours.
 * Never issues a refund itself — only flags for review (spec §21). */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-requirements:adjust-family", "requirements");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const result = await checkForOverpaymentAfterRequirementChange(organizationId, periodId, input.householdId);
    return Response.json({ ok: true, data: result });
  });
}
