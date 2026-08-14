import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";

/**
 * PTA-J — member documents (§19). Linkage-gated (household adult), NEVER the
 * RBAC attachment API: parents hold zero Permissions. Serves exactly two
 * things: organization documents an officer explicitly flagged
 * memberVisible, and the index of CURRENT governing documents.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaHouseholdSelfAccess();

    const [documents, governance] = await Promise.all([
      prisma.attachment.findMany({
        where: { organizationId, entityType: "ORGANIZATION_DOCUMENT", deletedAt: null, memberVisible: true },
        orderBy: { uploadedAt: "desc" },
        select: { id: true, fileName: true, title: true, purpose: true, byteSize: true, uploadedAt: true },
        take: 200,
      }),
      prisma.governanceDocument.findMany({
        where: { organizationId, status: "CURRENT" },
        orderBy: [{ docType: "asc" }, { title: "asc" }],
        select: { id: true, title: true, docType: true, version: true, effectiveDate: true, fileName: true },
      }),
    ]);

    return Response.json({ ok: true, data: { documents, governance } });
  });
}
