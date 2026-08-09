import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { setPtaHouseholdPrimaryContact } from "@/lib/labs/pta/households";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ adultId: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const { householdId } = await params;
    const { adultId } = await parseJsonBody(request, bodySchema);
    const household = await setPtaHouseholdPrimaryContact(organizationId, householdId, adultId, session.userId, session.userEmail);
    return Response.json({ ok: true, data: household });
  });
}
