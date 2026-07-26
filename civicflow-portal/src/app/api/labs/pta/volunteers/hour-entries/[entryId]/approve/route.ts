import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { approvePtaVolunteerHourEntry } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ adjustedMinutes: z.number().int().min(0).nullable().optional() });

/** Refuses self-approval — see assertNotSelfApproval() inside approvePtaVolunteerHourEntry(). */
export async function POST(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteer-hours:approve");
    const { entryId } = await params;
    const { adjustedMinutes } = await parseJsonBody(request, bodySchema).catch(() => ({ adjustedMinutes: null }));
    const entry = await approvePtaVolunteerHourEntry(organizationId, entryId, session.userId, { adjustedMinutes }, session.userEmail);
    return Response.json({ ok: true, data: entry });
  });
}
