import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaResidentRead, requireHoaResidentWrite } from "@/lib/hoa/guard";
import { assignPropertyResident, getPropertyResidentHistory, listActivePropertyResidents } from "@/lib/hoa/properties";
import { parseJsonBody, z } from "@/lib/validation";

const RELATIONSHIP_TYPES = ["OWNER", "CO_OWNER", "RESIDENT", "TENANT", "NON_RESIDENT_OWNER", "OTHER"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireHoaResidentRead();
    const { propertyId } = await params;
    const url = new URL(request.url);
    const includeHistory = url.searchParams.get("history") === "true";
    const residents = includeHistory
      ? await getPropertyResidentHistory(organizationId, propertyId)
      : await listActivePropertyResidents(organizationId, propertyId);
    return Response.json({ ok: true, data: residents });
  });
}

const assignSchema = z.object({
  orgMemberId: z.string().min(1),
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  isPrimaryContact: z.boolean().optional(),
  ownershipPercentage: z.number().min(0).max(100).nullable().optional(),
  moveInDate: z.coerce.date().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaResidentWrite();
    const { propertyId } = await params;
    const input = await parseJsonBody(request, assignSchema);
    const resident = await assignPropertyResident({
      organizationId,
      propertyId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      ...input,
    });
    return Response.json({ ok: true, data: resident }, { status: 201 });
  });
}
