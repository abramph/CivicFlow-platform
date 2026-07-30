import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { rejectPtaVolunteerHourEntry } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ reason: z.string().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteer-hours:approve");
    const { entryId } = await params;
    const { reason } = await parseJsonBody(request, bodySchema);
    const entry = await rejectPtaVolunteerHourEntry(organizationId, entryId, reason, session.userId, session.userEmail);
    return Response.json({ ok: true, data: entry });
  });
}
