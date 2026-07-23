import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { removePtaHouseholdAdult } from "@/lib/labs/pta/households";

export async function DELETE(_request: Request, { params }: { params: Promise<{ householdId: string; adultId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const { householdId, adultId } = await params;
    await removePtaHouseholdAdult(organizationId, householdId, adultId, session.userId, session.userEmail);
    return Response.json({ ok: true });
  });
}
