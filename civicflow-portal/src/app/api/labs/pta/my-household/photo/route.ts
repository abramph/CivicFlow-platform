import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { uploadHouseholdPhoto, deleteHouseholdPhoto } from "@/lib/labs/pta/household-photo";

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Parent self-service family-photo upload — mirrors my-household/route.ts's
 * own convention exactly: requirePtaHouseholdSelfAccess() resolves the
 * household from the caller's own linked PtaHouseholdAdult.userId, never
 * from a client-supplied id, so a parent can never target another
 * household's photo. Auth-ordering follow-up discipline applied throughout
 * (matches fix/import-auth-order-and-format-ui): auth before any body
 * access, declared Content-Length checked before parsing, Content-Type
 * checked before parsing, a malformed multipart body surfaces as a clean
 * 400, never a raw exception.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult, session } = await requirePtaHouseholdSelfAccess();

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
      householdId: adult.householdId,
      buffer,
      declaredContentType: file.type || "application/octet-stream",
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}

export async function DELETE() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult, session } = await requirePtaHouseholdSelfAccess();
    await deleteHouseholdPhoto({ organizationId, householdId: adult.householdId, actorUserId: session.userId, actorEmail: session.userEmail });
    return Response.json({ ok: true });
  });
}
