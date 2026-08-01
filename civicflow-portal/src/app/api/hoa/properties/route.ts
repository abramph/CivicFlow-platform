import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaPropertyRead, requireHoaPropertyWrite } from "@/lib/hoa/guard";
import { createProperty, listProperties } from "@/lib/hoa/properties";
import { parseJsonBody, z } from "@/lib/validation";

const PROPERTY_TYPES = ["SINGLE_FAMILY", "CONDO_UNIT", "TOWNHOME", "VACANT_LOT", "COMMON_PROPERTY", "OTHER"] as const;

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireHoaPropertyRead();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const propertyType = url.searchParams.get("propertyType");
    const result = await listProperties(organizationId, {
      status: status === "ACTIVE" || status === "INACTIVE" ? status : undefined,
      propertyType: PROPERTY_TYPES.includes(propertyType as (typeof PROPERTY_TYPES)[number])
        ? (propertyType as (typeof PROPERTY_TYPES)[number])
        : undefined,
      search: url.searchParams.get("search") ?? undefined,
      noActiveResident: url.searchParams.get("noActiveResident") === "true",
      take: url.searchParams.get("take") ? Number(url.searchParams.get("take")) : undefined,
      skip: url.searchParams.get("skip") ? Number(url.searchParams.get("skip")) : undefined,
    });
    return Response.json({ ok: true, data: result });
  });
}

const createSchema = z.object({
  addressLine1: z.string().min(1),
  addressLine2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  unitLabel: z.string().nullable().optional(),
  buildingLabel: z.string().nullable().optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  displayName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaPropertyWrite();
    const input = await parseJsonBody(request, createSchema);
    const property = await createProperty({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      ...input,
    });
    return Response.json({ ok: true, data: property }, { status: 201 });
  });
}
