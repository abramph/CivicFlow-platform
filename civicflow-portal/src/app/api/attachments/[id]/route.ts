import { createAuditEvent } from "@/lib/audit";
import { attachmentPermission } from "@/lib/attachments";
import { requirePermission, withForbiddenHandler } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { deleteObjectFromSpaces } from "@/lib/storage";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return withForbiddenHandler(async () => {
    const { id } = await params;
    const existing = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });

    const { session, organizationId } = await requirePermission(attachmentPermission(existing.entityType, "write"), "throw");
    if (organizationId !== existing.organizationId) {
      return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });
    }

    const row = await prisma.attachment.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByUserId: session.userId },
    });

    if (existing.entityType === "ORGANIZATION" && existing.purpose === "LOGO") {
      const activeLogo = await prisma.attachment.findFirst({
        where: {
          organizationId,
          entityType: "ORGANIZATION",
          entityId: organizationId,
          purpose: "LOGO",
          deletedAt: null,
        },
        orderBy: { uploadedAt: "desc" },
      });
      await prisma.organization.update({
        where: { id: organizationId },
        data: { logoUrl: activeLogo ? `/api/attachments/${activeLogo.id}/download` : null },
      });
    }

    try {
      await deleteObjectFromSpaces(existing.objectKey);
    } catch {
      // Preserve the audit trail even if remote object cleanup is temporarily unavailable.
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "attachment.delete",
      entityType: "attachment",
      entityId: id,
      metadata: {
        attachmentEntityType: row.entityType,
        attachmentEntityId: row.entityId,
        fileName: row.fileName,
        objectKey: row.objectKey,
      },
    });

    return Response.json({ ok: true, data: row });
  });
}
