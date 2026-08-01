import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaPropertyRead, requireHoaPropertyWrite } from "@/lib/hoa/guard";
import { getProperty, updateProperty } from "@/lib/hoa/properties";
import { parseJsonBody, z } from "@/lib/validation";

const PROPERTY_TYPES = ["SINGLE_FAMILY", "CONDO_UNIT", "TOWNHOME", "VACANT_LOT", "COMMON_PROPERTY", "OTHER"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireHoaPropertyRead();
    const { propertyId } = await params;
    const property = await getProperty(organizationId, propertyId);
    return Response.json({ ok: true, data: property });
  });
}

const updateSchema = z.object({
  addressLine1: z.string().min(1).optional(),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  unitLabel: z.string().nullable().optional(),
  buildingLabel: z.string().nullable().optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  displayName: z.string().nullable().optional(),
  billingMemberId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaPropertyWrite();
    const { propertyId } = await params;
    const input = await parseJsonBody(request, updateSchema);
    const property = await updateProperty(organizationId, propertyId, {
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      ...input,
    });
    return Response.json({ ok: true, data: property });
  });
}
