import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { getGovernanceDocumentDownloadUrl } from "@/lib/governance-documents";

/** Redirects to a short-lived signed URL; every download is audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("governance:read", "throw");
    const { documentId } = await params;
    const { document, url } = await getGovernanceDocumentDownloadUrl(organizationId, documentId);
    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "governance.document_downloaded",
      entityType: "governance_document",
      entityId: document.id,
      metadata: { title: document.title, version: document.version },
    });
    return Response.redirect(url, 302);
  });
}
