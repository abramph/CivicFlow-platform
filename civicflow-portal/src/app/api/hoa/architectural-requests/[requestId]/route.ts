import { withApiErrorHandling } from "@/lib/api-route";
import { requireArchitecturalRequestRead } from "@/lib/hoa/architectural-requests-guard";
import { getArchitecturalRequestDetail } from "@/lib/hoa/architectural-requests";

export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireArchitecturalRequestRead();
    const { requestId } = await params;
    const request = await getArchitecturalRequestDetail(organizationId, requestId);
    return Response.json({ ok: true, data: request });
  });
}
