import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build 27 — mobile bearer-token bridge for the STUDENT photo. The pipeline
 * itself is covered against real sharp fixtures via household-photo.test.ts
 * (both modules share photo-pipeline.ts), so this file proves the
 * bridge-specific concerns: the studentId route param is never an
 * authorization input (the student must belong to the caller's OWN
 * household, re-derived from their linkage), another family's student
 * answers "not found" without confirming existence, and delivery is bytes
 * with the same privacy headers as the family photo.
 */

const requireMobilePtaHouseholdAccess = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, requireMobilePtaHouseholdAccess: (...a: unknown[]) => requireMobilePtaHouseholdAccess(...a) };
});

const uploadStudentPhoto = vi.fn();
const deleteStudentPhoto = vi.fn();
const getStudentPhotoBytes = vi.fn();
vi.mock("@/lib/labs/pta/student-photo", () => ({
  uploadStudentPhoto: (...a: unknown[]) => uploadStudentPhoto(...a),
  deleteStudentPhoto: (...a: unknown[]) => deleteStudentPhoto(...a),
  getStudentPhotoBytes: (...a: unknown[]) => getStudentPhotoBytes(...a),
}));

const findFirstStudent = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { ptaStudent: { findFirst: (...a: unknown[]) => findFirstStudent(...a) } },
}));

const requireRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const ORG_ID = "org-1";
const HOUSEHOLD_ID = "household-1";
const STUDENT_ID = "student-1";
const ACCESS = {
  organizationId: ORG_ID,
  adult: { id: "adult-1", householdId: HOUSEHOLD_ID, billingMemberId: null },
  session: { userId: "user-1", email: "parent@example.org" },
};

function url(studentId = STUDENT_ID) {
  return `https://portal.test/api/mobile/pta/students/${studentId}/photo?organizationId=${encodeURIComponent(ORG_ID)}`;
}
const params = (studentId = STUDENT_ID) => ({ params: Promise.resolve({ studentId }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireMobilePtaHouseholdAccess.mockResolvedValue(ACCESS);
  requireRateLimit.mockResolvedValue(null);
  findFirstStudent.mockResolvedValue({ id: STUDENT_ID });
  uploadStudentPhoto.mockResolvedValue({ photoUrl: `/api/labs/pta/students/${STUDENT_ID}/photo`, byteSize: 100, width: 10, height: 10 });
  deleteStudentPhoto.mockResolvedValue(undefined);
  getStudentPhotoBytes.mockResolvedValue({ buffer: JPEG_BYTES, contentType: "image/jpeg", byteSize: JPEG_BYTES.byteLength });
});

describe("GET /api/mobile/pta/students/[studentId]/photo", () => {
  it("scopes the student lookup to the caller's OWN household — the studentId is display routing, not authorization", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request(url()), params());

    expect(res.status).toBe(200);
    expect(findFirstStudent).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: STUDENT_ID, organizationId: ORG_ID, householdId: HOUSEHOLD_ID, status: "ACTIVE" }),
      })
    );
  });

  it("answers 404 for another family's student without touching storage", async () => {
    findFirstStudent.mockResolvedValueOnce(null);
    const { GET } = await import("../route");
    const res = await GET(new Request(url("someone-elses-student")), params("someone-elses-student"));

    expect(res.status).toBe(404);
    expect(getStudentPhotoBytes).not.toHaveBeenCalled();
  });

  it("returns bytes with the family photo's privacy headers, never a redirect or storage reference", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request(url()), params());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("location")).toBeNull();
    const body = Buffer.from(await res.arrayBuffer());
    const asText = body.toString("latin1") + JSON.stringify([...res.headers.entries()]);
    expect(asText).not.toContain("X-Amz-Signature");
    expect(asText).not.toContain("digitaloceanspaces");
  });

  it("propagates the guard's denial before any student lookup", async () => {
    const { MobileForbiddenError } = await import("@/lib/mobile-auth");
    requireMobilePtaHouseholdAccess.mockRejectedValueOnce(new MobileForbiddenError("no household"));
    const { GET } = await import("../route");
    const res = await GET(new Request(url()), params());

    expect(res.status).toBe(403);
    expect(findFirstStudent).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/pta/students/[studentId]/photo", () => {
  function multipartRequest(file: File | null): Request {
    const form = new FormData();
    if (file) form.set("file", file);
    return new Request(url(), { method: "POST", body: form });
  }

  it("uploads through the shared service for the caller's own student", async () => {
    const { POST } = await import("../route");
    const file = new File([JPEG_BYTES], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(multipartRequest(file), params());

    expect(res.status).toBe(200);
    expect(uploadStudentPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, studentId: STUDENT_ID, declaredContentType: "image/jpeg", actorUserId: "user-1" })
    );
  });

  it("404s for another family's student before reading the body", async () => {
    findFirstStudent.mockResolvedValueOnce(null);
    const { POST } = await import("../route");
    const file = new File([JPEG_BYTES], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(multipartRequest(file), params());

    expect(res.status).toBe(404);
    expect(uploadStudentPhoto).not.toHaveBeenCalled();
  });

  it("rejects a non-multipart body with 415 after auth", async () => {
    const { POST } = await import("../route");
    const res = await POST(new Request(url(), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), params());
    expect(res.status).toBe(415);
    expect(uploadStudentPhoto).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    requireRateLimit.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const { POST } = await import("../route");
    const res = await POST(multipartRequest(new File([JPEG_BYTES], "photo.jpg", { type: "image/jpeg" })), params());
    expect(res.status).toBe(429);
    expect(requireMobilePtaHouseholdAccess).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/mobile/pta/students/[studentId]/photo", () => {
  it("removes the caller's own student's photo through the shared service", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params());
    expect(res.status).toBe(200);
    expect(deleteStudentPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, studentId: STUDENT_ID, actorUserId: "user-1" })
    );
  });

  it("404s for another family's student without touching the service", async () => {
    findFirstStudent.mockResolvedValueOnce(null);
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request(url("someone-elses-student"), { method: "DELETE" }), params("someone-elses-student"));
    expect(res.status).toBe(404);
    expect(deleteStudentPhoto).not.toHaveBeenCalled();
  });
});
