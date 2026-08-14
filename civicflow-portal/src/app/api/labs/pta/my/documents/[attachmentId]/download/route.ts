import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";

/** PTA-J — member download of a memberVisible organization document.
 * Self-access guard + explicit visibility check; audited; 404 for anything
 * not deliberately shared. */
export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaHouseholdSelfAccess();
    const { attachmentId } = await params;

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, organizationId, entityType: "ORGANIZATION_DOCUMENT", deletedAt: null, memberVisible: true },
    });
    if (!attachment) return Response.json({ ok: false, error: "Document not found." }, { status: 404 });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "attachment.member_download",
      entityType: "attachment",
      entityId: attachment.id,
      metadata: { fileName: attachment.fileName },
    });

    const url = await getSignedObjectUrl(attachment.objectKey, 300);
    return Response.redirect(url, 302);
  });
}
