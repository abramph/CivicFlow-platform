import { createAuditEvent } from "@/lib/audit";
import { attachmentPermission, verifyAttachmentOwnership } from "@/lib/attachments";
import { requirePermission, withForbiddenHandler } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { deleteObjectFromSpaces } from "@/lib/storage";

/** Reimbursement statuses where the receipt is settled financial evidence,
 * not a draft attachment — deletion past this point is restricted to
 * finance managers and never purges the underlying object (see DELETE
 * below). */
const REIMBURSEMENT_EVIDENCE_STATUSES = new Set(["PAID", "VOIDED", "REVERSED"]);

/** PATCH /api/attachments/:id — PTA-J: flip member visibility. Requires the
 * entity type's WRITE permission; the member-facing routes only ever serve
 * rows where this flag is true. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withForbiddenHandler(async () => {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { memberVisible?: unknown } | null;
    if (!body || typeof body.memberVisible !== "boolean") {
      return Response.json({ ok: false, error: "memberVisible (boolean) is required." }, { status: 400 });
    }
    const existing = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });

    const { session, organizationId, can } = await requirePermission(attachmentPermission(existing.entityType, "write"), "throw");
    if (organizationId !== existing.organizationId) {
      return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });
    }
    if (
      !(await verifyAttachmentOwnership(organizationId, existing.entityType, existing.entityId, {
        userId: session.userId,
        canManage: can("reimbursements:manage"),
      }))
    ) {
      return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });
    }

    const row = await prisma.attachment.update({ where: { id }, data: { memberVisible: body.memberVisible } });
    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: body.memberVisible ? "attachment.member_visible_enabled" : "attachment.member_visible_disabled",
      entityType: "attachment",
      entityId: id,
      metadata: { fileName: row.fileName },
    });
    return Response.json({ ok: true, data: row });
  });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return withForbiddenHandler(async () => {
    const { id } = await params;
    const existing = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });

    const { session, organizationId, can } = await requirePermission(attachmentPermission(existing.entityType, "write"), "throw");
    if (organizationId !== existing.organizationId) {
      return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });
    }
    const canManageReimbursements = can("reimbursements:manage");
    if (
      !(await verifyAttachmentOwnership(organizationId, existing.entityType, existing.entityId, {
        userId: session.userId,
        canManage: canManageReimbursements,
      }))
    ) {
      return Response.json({ ok: false, error: "Attachment not found." }, { status: 404 });
    }

    // A reimbursement receipt attached to a request that has already been
    // paid, voided, or reversed is settled financial evidence, not a draft
    // upload — removal past that point requires a finance manager and,
    // deliberately, never purges the underlying object (see below).
    let isSettledFinancialEvidence = false;
    if (existing.entityType === "REIMBURSEMENT") {
      const reimbursement = await prisma.reimbursementRequest.findFirst({
        where: { id: existing.entityId, organizationId },
        select: { status: true },
      });
      isSettledFinancialEvidence = Boolean(reimbursement && REIMBURSEMENT_EVIDENCE_STATUSES.has(reimbursement.status));
      if (isSettledFinancialEvidence && !canManageReimbursements) {
        return Response.json({ ok: false, error: "Only a finance manager can remove a receipt from a paid reimbursement." }, { status: 403 });
      }
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

    if (isSettledFinancialEvidence) {
      // Preferably preserve the record rather than silently delete
      // evidence: the row is soft-deleted (hidden from ordinary listings)
      // but the underlying object is deliberately NOT purged from storage.
    } else {
      try {
        await deleteObjectFromSpaces(existing.objectKey);
      } catch {
        // Preserve the audit trail even if remote object cleanup is temporarily unavailable.
      }
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: isSettledFinancialEvidence ? "attachment.delete_evidence_preserved" : "attachment.delete",
      entityType: "attachment",
      entityId: id,
      metadata: {
        attachmentEntityType: row.entityType,
        attachmentEntityId: row.entityId,
        fileName: row.fileName,
        objectKey: row.objectKey,
        objectPreserved: isSettledFinancialEvidence,
      },
    });

    return Response.json({ ok: true, data: row });
  });
}
