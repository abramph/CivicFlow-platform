import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * build-26 Phase F -- mobile bearer-token bridge for the family photo.
 * Reuses household-photo.ts (already covered end-to-end against real sharp
 * fixtures in src/lib/labs/pta/__tests__/household-photo.test.ts) so this
 * file only proves the bridge-specific concerns: organizationId resolved
 * from the query string (not the body) so auth can run before the request
 * body is ever read, the household id always comes from the caller's own
 * PtaHouseholdAdult linkage, and the GET shape is JSON (not a redirect) --
 * required because apiFetch() on the mobile client parses a {ok,data} JSON
 * envelope and would choke on a raw redirect to binary image bytes.
 */

const requireMobilePtaHouseholdAccess = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, requireMobilePtaHouseholdAccess: (...a: unknown[]) => requireMobilePtaHouseholdAccess(...a) };
});

const uploadHouseholdPhoto = vi.fn();
const deleteHouseholdPhoto = vi.fn();
const getHouseholdPhotoAttachment = vi.fn();
vi.mock("@/lib/labs/pta/household-photo", () => ({
  uploadHouseholdPhoto: (...a: unknown[]) => uploadHouseholdPhoto(...a),
  deleteHouseholdPhoto: (...a: unknown[]) => deleteHouseholdPhoto(...a),
  getHouseholdPhotoAttachment: (...a: unknown[]) => getHouseholdPhotoAttachment(...a),
}));

const getSignedObjectUrl = vi.fn();
vi.mock("@/lib/storage", () => ({ getSignedObjectUrl: (...a: unknown[]) => getSignedObjectUrl(...a) }));

const requireRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

import { MobileForbiddenError, MobileAuthError } from "@/lib/mobile-auth";

const ORG_ID = "org-1";
const HOUSEHOLD_ID = "household-1";
const ACCESS = {
  organizationId: ORG_ID,
  adult: { id: "adult-1", householdId: HOUSEHOLD_ID, billingMemberId: null },
  session: { userId: "user-1", email: "parent@example.org" },
};

function url(path: string) {
  return `https://portal.test${path}?organizationId=${encodeURIComponent(ORG_ID)}`;
}

function multipartRequest(file: File | null): Request {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request(url("/api/mobile/pta/household/photo"), { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobilePtaHouseholdAccess.mockResolvedValue(ACCESS);
  requireRateLimit.mockResolvedValue(null);
  uploadHouseholdPhoto.mockResolvedValue({ photoUrl: `/api/labs/pta/households/${HOUSEHOLD_ID}/photo`, byteSize: 100, width: 10, height: 10 });
  deleteHouseholdPhoto.mockResolvedValue(undefined);
  getHouseholdPhotoAttachment.mockResolvedValue({ id: "attachment-1", objectKey: "attachments/org-1/pta_household/household-1/photo.jpg", byteSize: 100 });
  getSignedObjectUrl.mockResolvedValue("https://spaces.example/signed-url");
});

describe("GET /api/mobile/pta/household/photo", () => {
  it("requires organizationId in the query string", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/api/mobile/pta/household/photo"));
    expect(res.status).toBe(400);
    expect(requireMobilePtaHouseholdAccess).not.toHaveBeenCalled();
  });

  it("returns JSON with a short-lived signed URL, not a redirect", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true, data: { url: "https://spaces.example/signed-url", byteSize: 100 } });
    expect(getSignedObjectUrl).toHaveBeenCalledWith("attachments/org-1/pta_household/household-1/photo.jpg", 300);
  });

  it("returns null data (not an error) when the household has no photo", async () => {
    getHouseholdPhotoAttachment.mockResolvedValueOnce(null);
    const { GET } = await import("../route");
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));
    const payload = await res.json();
    expect(res.status).toBe(200);
    expect(payload).toEqual({ ok: true, data: null });
  });

  it("propagates a bearer-auth failure without querying the attachment", async () => {
    requireMobilePtaHouseholdAccess.mockRejectedValueOnce(new MobileAuthError("Invalid or expired access token"));
    const { GET } = await import("../route");
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));
    expect(res.status).toBe(401);
    expect(getHouseholdPhotoAttachment).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/pta/household/photo", () => {
  it("resolves organizationId from the query string, authenticating before the body is ever read", async () => {
    requireMobilePtaHouseholdAccess.mockRejectedValueOnce(new MobileForbiddenError("not linked"));
    const { POST } = await import("../route");
    // A body that would throw if formData() were ever called on it before auth ran.
    const req = new Request(url("/api/mobile/pta/household/photo"), {
      method: "POST",
      body: "garbage-not-multipart",
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("checks the rate limit before authenticating", async () => {
    requireRateLimit.mockResolvedValueOnce(Response.json({ ok: false, error: "Rate limit exceeded. Please retry later." }, { status: 429 }));
    const { POST } = await import("../route");
    const res = await POST(multipartRequest(new File([new Uint8Array([1])], "photo.jpg", { type: "image/jpeg" })));
    expect(res.status).toBe(429);
    expect(requireMobilePtaHouseholdAccess).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared Content-Length with 413 before parsing", async () => {
    const { POST } = await import("../route");
    const req = new Request(url("/api/mobile/pta/household/photo"), {
      method: "POST",
      body: "x",
      headers: { "content-length": String(15 * 1024 * 1024 + 1), "content-type": "multipart/form-data; boundary=x" },
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("rejects a non-multipart content-type with 415", async () => {
    const { POST } = await import("../route");
    const req = new Request(url("/api/mobile/pta/household/photo"), { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("uploads using the caller's own household id from bearer-token linkage", async () => {
    const { POST } = await import("../route");
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(multipartRequest(file));
    expect(res.status).toBe(200);
    expect(uploadHouseholdPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, householdId: HOUSEHOLD_ID, actorUserId: "user-1", actorEmail: "parent@example.org" })
    );
  });

  it("rejects a file over 15MB with 413", async () => {
    const { POST } = await import("../route");
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(multipartRequest(big));
    expect(res.status).toBe(413);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/mobile/pta/household/photo", () => {
  it("deletes using the caller's own household id", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request(url("/api/mobile/pta/household/photo")));
    expect(res.status).toBe(200);
    expect(deleteHouseholdPhoto).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_ID, householdId: HOUSEHOLD_ID }));
  });
});
