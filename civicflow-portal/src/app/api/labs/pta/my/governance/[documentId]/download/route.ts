import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";

/** PTA-J — member download of a CURRENT governing document (§19
 * "Governance information"). Bylaws belong to the membership; only the
 * CURRENT version is ever served here — history stays officer-side. */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaHouseholdSelfAccess();
    const { documentId } = await params;

    const document = await prisma.governanceDocument.findFirst({
      where: { id: documentId, organizationId, status: "CURRENT" },
    });
    if (!document || !document.objectKey) return Response.json({ ok: false, error: "Document not found." }, { status: 404 });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "governance.member_download",
      entityType: "governance_document",
      entityId: document.id,
      metadata: { title: document.title, version: document.version },
    });

    const url = await getSignedObjectUrl(document.objectKey, 300);
    return Response.redirect(url, 302);
  });
}
