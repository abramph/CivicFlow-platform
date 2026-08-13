import { createAuditEvent } from "@/lib/audit";
import { attachmentPermission, attachmentPrefix, isAttachmentEntityType, maxAttachmentBytes, verifyAttachmentEntity } from "@/lib/attachments";
import { requirePermission, withForbiddenHandler } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { buildSafeObjectKey, uploadBufferToSpaces } from "@/lib/storage";

function textValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  return withForbiddenHandler(async () => {
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId") ?? "";
    if (!isAttachmentEntityType(entityType)) {
      return Response.json({ ok: false, error: "Invalid attachment entity type." }, { status: 400 });
    }

    const { organizationId } = await requirePermission(attachmentPermission(entityType, "read"), "throw");
    if (!(await verifyAttachmentEntity(organizationId, entityType, entityId))) {
      return Response.json({ ok: false, error: "Attachment entity not found in organization." }, { status: 404 });
    }

    // Optional purpose filter (PTA-D follow-up): the Document Center shows
    // one entityId across many folder tabs, so listing must be able to
    // scope to a folder. Only applied when the caller asks — existing
    // single-purpose surfaces keep seeing every row for their entity.
    const purpose = searchParams.get("purpose");
    const rows = await prisma.attachment.findMany({
      where: { organizationId, entityType, entityId, deletedAt: null, ...(purpose ? { purpose } : {}) },
      orderBy: [{ uploadedAt: "desc" }],
      take: 200,
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withForbiddenHandler(async () => {
    const formData = await request.formData();
    const entityType = textValue(formData.get("entityType"));
    const entityId = textValue(formData.get("entityId"));
    const purpose = textValue(formData.get("purpose")) || null;
    const title = textValue(formData.get("title")) || null;
    const description = textValue(formData.get("description")) || null;
    const file = formData.get("file");

    if (!isAttachmentEntityType(entityType)) {
      return Response.json({ ok: false, error: "Invalid attachment entity type." }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: "Choose a file to upload." }, { status: 400 });
    }
    if (file.size <= 0) {
      return Response.json({ ok: false, error: "The selected file is empty." }, { status: 400 });
    }
    if (file.size > maxAttachmentBytes) {
      return Response.json({ ok: false, error: "Attachment exceeds the 15 MB upload limit." }, { status: 413 });
    }

    const { session, organizationId } = await requirePermission(attachmentPermission(entityType, "write"), "throw");
    if (!(await verifyAttachmentEntity(organizationId, entityType, entityId))) {
      return Response.json({ ok: false, error: "Attachment entity not found in organization." }, { status: 404 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const objectKey = buildSafeObjectKey(attachmentPrefix(organizationId, entityType, entityId), file.name);
    await uploadBufferToSpaces({
      key: objectKey,
      buffer,
      contentType: file.type || "application/octet-stream",
      metadata: {
        organizationId,
        entityType,
        entityId,
        uploadedByUserId: session.userId,
      },
    });

    const row = await prisma.attachment.create({
      data: {
        organizationId,
        entityType,
        entityId,
        purpose,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
        objectKey,
        title,
        description,
        uploadedByUserId: session.userId,
      },
    });

    if (entityType === "ORGANIZATION" && purpose === "LOGO") {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { logoUrl: `/api/attachments/${row.id}/download` },
      });
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "attachment.create",
      entityType: "attachment",
      entityId: row.id,
      metadata: { attachmentEntityType: entityType, attachmentEntityId: entityId, fileName: row.fileName, byteSize: row.byteSize, purpose },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
