import { withApiErrorHandling } from "@/lib/api-route";
import { requireOrganization } from "@/lib/auth-guards";
import { requirePtaAccess, requirePtaVertical } from "@/lib/labs/pta/guard";
import { uploadHouseholdPhoto, deleteHouseholdPhoto, getHouseholdPhotoAttachment } from "@/lib/labs/pta/household-photo";
import { PtaError } from "@/lib/labs/pta/errors";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * GET is the canonical route PtaHousehold.photoUrl points to, and it is
 * read by two different audiences: officers with directory-read access,
 * AND the household's own parents (who hold no Permission at all). Rather
 * than storing two different URLs for the same photo, this one route
 * accepts either caller — officer permission first, then a self-linkage
 * fallback check against THIS householdId (never trusts a parent's
 * assertion about which household they belong to; re-derives it from
 * PtaHouseholdAdult). An unauthorized caller sees "not found," matching
 * the generic /api/attachments/[id]/download route's own precedent of not
 * distinguishing "doesn't exist" from "not yours to see."
 */
export async function GET(_request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requireOrganization("throw");
    await requirePtaVertical(organizationId);
    const { householdId } = await params;

    let authorized = can("pta:directory:read");
    if (!authorized) {
      const adult = await prisma.ptaHouseholdAdult.findFirst({
        where: { organizationId, userId: session.userId, householdId },
        select: { id: true },
      });
      authorized = Boolean(adult);
    }
    if (!authorized) {
      throw new PtaError("PTA_HOUSEHOLD_NOT_FOUND", "Household not found in this organization.");
    }

    const attachment = await getHouseholdPhotoAttachment(organizationId, householdId);
    if (!attachment) {
      return Response.json({ ok: false, error: "No family photo on file." }, { status: 404 });
    }
    const url = await getSignedObjectUrl(attachment.objectKey, 300);
    return Response.redirect(url);
  });
}

/**
 * Officer-managed family-photo upload — the SAME pta:households:manage
 * permission that already gates every other household edit (add/remove
 * adult, deactivate, etc.); no new grant is introduced for this. Same
 * auth-before-parse discipline as the parent self-service route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const { householdId } = await params;

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return Response.json({ ok: false, error: "Photo exceeds the 15 MB upload limit." }, { status: 413 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return Response.json({ ok: false, error: "Unsupported content type. Expected a multipart/form-data file upload." }, { status: 415 });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ ok: false, error: "Could not read the uploaded photo. Please try again." }, { status: 400 });
    }

    const file = form.get("file") as File | null;
    if (!file) {
      return Response.json({ ok: false, error: "No photo uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ ok: false, error: "Photo exceeds the 15 MB upload limit." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadHouseholdPhoto({
      organizationId,
      householdId,
      buffer,
      declaredContentType: file.type || "application/octet-stream",
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ householdId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:households:manage");
    const { householdId } = await params;
    await deleteHouseholdPhoto({ organizationId, householdId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true });
  });
}
