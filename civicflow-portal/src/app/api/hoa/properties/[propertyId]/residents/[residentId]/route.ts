import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaResidentWrite } from "@/lib/hoa/guard";
import { updatePropertyResident } from "@/lib/hoa/properties";
import { parseJsonBody, z } from "@/lib/validation";

const RELATIONSHIP_TYPES = ["OWNER", "CO_OWNER", "RESIDENT", "TENANT", "NON_RESIDENT_OWNER", "OTHER"] as const;

const updateSchema = z.object({
  relationshipType: z.enum(RELATIONSHIP_TYPES).optional(),
  isPrimaryContact: z.boolean().optional(),
  ownershipPercentage: z.number().min(0).max(100).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ propertyId: string; residentId: string }> }
) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaResidentWrite();
    const { residentId } = await params;
    const input = await parseJsonBody(request, updateSchema);
    const resident = await updatePropertyResident(organizationId, residentId, {
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      ...input,
    });
    return Response.json({ ok: true, data: resident });
  });
}
