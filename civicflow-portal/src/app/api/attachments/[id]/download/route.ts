import { NextResponse } from "next/server";
import { attachmentPermission } from "@/lib/attachments";
import { requirePermission, withForbiddenHandler } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return withForbiddenHandler(async () => {
    const { id } = await params;
    const existing = await prisma.attachment.findFirst({
      where: { id, deletedAt: null },
      select: { organizationId: true, entityType: true, objectKey: true },
    });
    if (!existing) return NextResponse.json({ ok: false, error: "Attachment not found." }, { status: 404 });

    const { organizationId } = await requirePermission(attachmentPermission(existing.entityType, "read"), "throw");
    if (organizationId !== existing.organizationId) {
      return NextResponse.json({ ok: false, error: "Attachment not found." }, { status: 404 });
    }

    const url = await getSignedObjectUrl(existing.objectKey, 300);
    return NextResponse.redirect(url);
  });
}
