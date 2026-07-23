import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { cancelPtaVolunteerSignup } from "@/lib/labs/pta/volunteers";

export async function POST(_request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requirePtaHouseholdSelfAccess();
    const { slotId } = await params;
    const signup = await cancelPtaVolunteerSignup(organizationId, slotId, adult.id, session.userId, session.userEmail);
    return Response.json({ ok: true, data: signup });
  });
}
