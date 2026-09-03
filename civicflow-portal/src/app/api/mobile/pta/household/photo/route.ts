import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { uploadHouseholdPhoto, deleteHouseholdPhoto, getHouseholdPhotoAttachment } from "@/lib/labs/pta/household-photo";
import { getSignedObjectUrl } from "@/lib/storage";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";

const MAX_BYTES = 15 * 1024 * 1024;

function organizationIdFromQuery(request: Request): string {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) throw new ValidationError("organizationId is required");
  return organizationId;
}

/**
 * GET /api/mobile/pta/household/photo?organizationId=...
 * Mobile bridge over household-photo.ts, mirroring the web parent
 * self-service route (my-household/photo) but bearer-authenticated. Unlike
 * the web GET route, this returns JSON with a signed URL rather than a
 * redirect: apiFetch() (src/lib/api-client.ts on the mobile side) expects a
 * {ok, data} JSON envelope and would try to parse the redirected image
 * bytes as JSON if this issued a raw Response.redirect().
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireMobilePtaHouseholdAccess(request, organizationIdFromQuery(request));
    const attachment = await getHouseholdPhotoAttachment(organizationId, adult.householdId);
    if (!attachment) return Response.json({ ok: true, data: null });
    const url = await getSignedObjectUrl(attachment.objectKey, 300);
    return Response.json({ ok: true, data: { url, byteSize: attachment.byteSize } });
  });
}

/**
 * POST /api/mobile/pta/household/photo?organizationId=...
 * organizationId travels in the query string (not the JSON/multipart body)
 * specifically so it -- and therefore the bearer-token auth check -- can be
 * resolved before the request body is ever read, preserving the
 * auth-before-parse discipline from fix/import-auth-order-and-format-ui for
 * this route's large (up to 15MB) multipart body.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const organizationId = organizationIdFromQuery(request);
    const rateLimited = await requireRateLimit({ scope: "api:mobile:pta:household-photo", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId: verifiedOrgId, adult, session } = await requireMobilePtaHouseholdAccess(request, organizationId);

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
      organizationId: verifiedOrgId,
      householdId: adult.householdId,
      buffer,
      declaredContentType: file.type || "application/octet-stream",
      actorUserId: session.userId,
      actorEmail: session.email,
    });
    return Response.json({ ok: true, data: result });
  });
}

export async function DELETE(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult, session } = await requireMobilePtaHouseholdAccess(request, organizationIdFromQuery(request));
    await deleteHouseholdPhoto({ organizationId, householdId: adult.householdId, actorUserId: session.userId, actorEmail: session.email });
    return Response.json({ ok: true });
  });
}
