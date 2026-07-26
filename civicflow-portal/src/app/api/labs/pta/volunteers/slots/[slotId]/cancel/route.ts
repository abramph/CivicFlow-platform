import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { cancelPtaVolunteerSignup } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ reason: z.string().nullable().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requirePtaHouseholdSelfAccess();
    const { slotId } = await params;
    const input = await parseJsonBody(request, bodySchema).catch(() => ({ reason: null }));
    const signup = await cancelPtaVolunteerSignup(organizationId, slotId, adult.id, session.userId, { reason: input.reason ?? null }, session.userEmail);
    return Response.json({ ok: true, data: signup });
  });
}
