import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { uploadStudentPhoto, deleteStudentPhoto, getStudentPhotoBytes } from "@/lib/labs/pta/student-photo";
import { familyPhotoBytesResponse, noFamilyPhotoResponse } from "@/lib/labs/pta/household-photo-response";
import { PtaError } from "@/lib/labs/pta/errors";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";

const MAX_BYTES = 15 * 1024 * 1024;

function organizationIdFromQuery(request: Request): string {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) throw new ValidationError("organizationId is required");
  return organizationId;
}

/**
 * Build 27 parent student-photo management — the mobile household-photo
 * route's exact sibling, same privacy contract
 * (docs/pta-family-photo-privacy.md): bytes only, authorization before any
 * storage access, auth-before-parse for the large multipart body.
 *
 * The one identifier the client supplies beyond organizationId is the
 * studentId — and it is never trusted as an authorization input: the
 * caller's household comes from their own PtaHouseholdAdult linkage
 * (requireMobilePtaHouseholdAccess), and the student must belong to THAT
 * household. A studentId from any other family answers "not found",
 * never confirming the student exists.
 */
async function requireOwnStudent(request: Request, studentId: string) {
  const access = await requireMobilePtaHouseholdAccess(request, organizationIdFromQuery(request));
  const student = await prisma.ptaStudent.findFirst({
    where: { id: studentId, organizationId: access.organizationId, householdId: access.adult.householdId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!student) throw new PtaError("PTA_STUDENT_NOT_FOUND", "Student not found in this organization.");
  return access;
}

export async function GET(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { studentId } = await params;
    const { organizationId } = await requireOwnStudent(request, studentId);
    const photo = await getStudentPhotoBytes(organizationId, studentId);
    if (!photo) return noFamilyPhotoResponse();
    return familyPhotoBytesResponse(photo);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:pta:student-photo", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { studentId } = await params;
    const { organizationId, session } = await requireOwnStudent(request, studentId);

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
    const result = await uploadStudentPhoto({
      organizationId,
      studentId,
      buffer,
      declaredContentType: file.type || "application/octet-stream",
      actorUserId: session.userId,
      actorEmail: session.email,
    });
    return Response.json({ ok: true, data: result });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:pta:student-photo", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { studentId } = await params;
    const { organizationId, session } = await requireOwnStudent(request, studentId);
    await deleteStudentPhoto({ organizationId, studentId, actorUserId: session.userId, actorEmail: session.email });
    return Response.json({ ok: true });
  });
}
