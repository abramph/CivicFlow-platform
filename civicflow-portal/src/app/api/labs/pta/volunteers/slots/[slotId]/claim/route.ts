import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { claimPtaVolunteerSlot } from "@/lib/labs/pta/volunteers";

/** Claims a seat for the CALLER'S OWN household-adult record only — householdAdultId is never accepted from the client, resolved server-side from requirePtaHouseholdSelfAccess(). */
export async function POST(_request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requirePtaHouseholdSelfAccess();
    const { slotId } = await params;
    const signup = await claimPtaVolunteerSlot(organizationId, slotId, adult.id, session.userId, session.userEmail);
    return Response.json({ ok: true, data: signup });
  });
}
