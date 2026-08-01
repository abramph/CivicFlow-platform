import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaPropertyWrite } from "@/lib/hoa/guard";
import { archiveProperty } from "@/lib/hoa/properties";

export async function POST(_request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaPropertyWrite();
    const { propertyId } = await params;
    const property = await archiveProperty(organizationId, propertyId, {
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: property });
  });
}
