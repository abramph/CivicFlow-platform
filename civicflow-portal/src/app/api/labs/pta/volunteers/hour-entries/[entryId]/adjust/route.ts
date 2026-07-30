import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { adjustPtaVolunteerHourEntry } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ minuteAdjustment: z.number().int(), reason: z.string().min(1) });

/** Only ever applies to an already-APPROVED entry, via an immutable adjustment record — see adjustPtaVolunteerHourEntry()'s doc comment. */
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteer-hours:approve");
    const { entryId } = await params;
    const { minuteAdjustment, reason } = await parseJsonBody(request, bodySchema);
    const entry = await adjustPtaVolunteerHourEntry(organizationId, entryId, minuteAdjustment, reason, session.userId, session.userEmail);
    return Response.json({ ok: true, data: entry });
  });
}
