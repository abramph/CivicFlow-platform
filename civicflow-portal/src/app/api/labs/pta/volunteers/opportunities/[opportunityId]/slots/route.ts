import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { addPtaVolunteerSlot } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  label: z.string().nullable().optional(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
  capacity: z.number().int().min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { opportunityId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const slot = await addPtaVolunteerSlot(organizationId, opportunityId, input, session.userId, session.userEmail);
    return Response.json({ ok: true, data: slot });
  });
}
