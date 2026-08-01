import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaResidentWrite } from "@/lib/hoa/guard";
import { endPropertyResidentRelationship } from "@/lib/hoa/properties";
import { parseJsonBody, z } from "@/lib/validation";

const endSchema = z.object({
  moveOutDate: z.coerce.date().nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; residentId: string }> }
) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaResidentWrite();
    const { residentId } = await params;
    const input = await parseJsonBody(request, endSchema);
    const resident = await endPropertyResidentRelationship(organizationId, residentId, {
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      ...input,
    });
    return Response.json({ ok: true, data: resident });
  });
}
