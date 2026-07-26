import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { listPtaOrganizationDocuments } from "@/lib/labs/pta/minutes";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/pta/documents?organizationId=...
 * Metadata only — title, file type, upload date. `downloadable: false` is
 * always returned honestly: the seeded demo documents have no real file
 * behind them (fictional `objectKey` placeholders), and this route makes
 * no attempt to serve one. See minutes.ts's doc comment for why this is
 * genuinely new surface area, not a bridge onto an existing capability.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobilePtaHouseholdAccess(request, organizationId);

    const documents = await listPtaOrganizationDocuments(verifiedOrgId);
    const data = documents.map((d) => ({
      id: d.id,
      title: d.title ?? d.fileName,
      fileName: d.fileName,
      contentType: d.contentType,
      uploadedAt: d.uploadedAt,
      downloadable: false,
    }));

    return Response.json({ ok: true, data });
  });
}
