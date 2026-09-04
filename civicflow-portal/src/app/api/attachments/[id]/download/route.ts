import { attachmentPermission, verifyAttachmentOwnership } from "@/lib/attachments";
import { attachmentBytesResponse, attachmentNotFoundResponse } from "@/lib/attachment-response";
import { requirePermission, withForbiddenHandler } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getObjectStream } from "@/lib/storage";

/**
 * Serves an attachment's BYTES to a caller this route has already authorized.
 *
 * It used to end in NextResponse.redirect(getSignedObjectUrl(key, 300)). A
 * signed URL is a bearer credential for the object: once issued it works for
 * anyone who obtains it, from any client, with no authorization check, no way
 * to revoke it before it expires, and served by a host that cannot tell who is
 * asking. The attachments behind this route include reimbursement receipts,
 * payment reports, meeting recordings and organization logos, so it carries
 * the same exposure the family-photo routes did.
 *
 * The metadata lookup necessarily precedes authorization, because the
 * permission to require is selected from the attachment's own entityType. Only
 * non-sensitive routing fields are read at that point, and the organization,
 * permission and ownership checks all complete before storage is touched — the
 * object is never opened for a caller who turns out not to be allowed it.
 *
 * The body is streamed rather than buffered: the largest attachments accepted
 * anywhere in this app are 150MB meeting recordings.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return withForbiddenHandler(async () => {
    const { id } = await params;
    const existing = await prisma.attachment.findFirst({
      where: { id, deletedAt: null },
      select: {
        organizationId: true,
        entityType: true,
        entityId: true,
        objectKey: true,
        contentType: true,
        fileName: true,
        byteSize: true,
      },
    });
    if (!existing) return attachmentNotFoundResponse();

    const { organizationId, session, can } = await requirePermission(attachmentPermission(existing.entityType, "read"), "throw");
    if (organizationId !== existing.organizationId) {
      return attachmentNotFoundResponse();
    }
    if (
      !(await verifyAttachmentOwnership(organizationId, existing.entityType, existing.entityId, {
        userId: session.userId,
        canManage: can("reimbursements:manage"),
      }))
    ) {
      return attachmentNotFoundResponse();
    }

    // Authorization is complete; only now is the object opened.
    let stream;
    try {
      stream = await getObjectStream(existing.objectKey);
    } catch {
      // A metadata row whose object is gone reads as "not found", never as a
      // 5xx carrying the bucket name or object key out to the caller.
      return attachmentNotFoundResponse();
    }

    return attachmentBytesResponse({
      stream,
      contentType: existing.contentType,
      fileName: existing.fileName,
      byteSize: existing.byteSize,
    });
  });
}
