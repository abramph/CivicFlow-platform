import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { uploadHouseholdPhoto, deleteHouseholdPhoto, getHouseholdPhotoBytes } from "@/lib/labs/pta/household-photo";
import { familyPhotoBytesResponse, noFamilyPhotoResponse } from "@/lib/labs/pta/household-photo-response";
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
 *
 * Returns the family photo's BYTES to an authorized caller.
 *
 * This used to return `{ url }` carrying a 5-minute signed object-storage
 * URL. That handed the client a bearer credential for a children's/household
 * image: anyone who obtained the URL could fetch it from any client, with no
 * authorization and no way to revoke it before expiry, and the image was then
 * served by a domain that has no idea who the caller is. The bytes now come
 * from this endpoint, which authorizes first.
 *
 * The household is resolved SERVER-SIDE from the bearer token's own
 * PtaHouseholdAdult linkage by requireMobilePtaHouseholdAccess. No household,
 * attachment, object or student identifier is accepted from the client, so
 * there is nothing for a caller to forge — only organizationId is read from
 * the query, and it is validated as one the caller actually belongs to.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    // Authorization happens before any storage access, and before the
    // household id even exists in this scope.
    const { organizationId, adult } = await requireMobilePtaHouseholdAccess(request, organizationIdFromQuery(request));
    const photo = await getHouseholdPhotoBytes(organizationId, adult.householdId);
    if (!photo) return noFamilyPhotoResponse();
    return familyPhotoBytesResponse(photo);
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
