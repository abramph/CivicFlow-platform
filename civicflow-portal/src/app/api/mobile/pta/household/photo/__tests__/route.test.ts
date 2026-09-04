import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * build-26 Phase F -- mobile bearer-token bridge for the family photo.
 * Reuses household-photo.ts (already covered end-to-end against real sharp
 * fixtures in src/lib/labs/pta/__tests__/household-photo.test.ts) so this
 * file only proves the bridge-specific concerns: organizationId resolved
 * from the query string (not the body) so auth can run before the request
 * body is ever read, the household id always comes from the caller's own
 * PtaHouseholdAdult linkage, and -- since the Build 26 privacy correction --
 * that GET returns the image BYTES rather than a signed object-storage URL.
 * A signed URL is a bearer credential for a children's/household image:
 * shareable, unrevocable until it expires, and served by a host that cannot
 * tell who is asking. These tests exist to keep one from coming back.
 */

const requireMobilePtaHouseholdAccess = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, requireMobilePtaHouseholdAccess: (...a: unknown[]) => requireMobilePtaHouseholdAccess(...a) };
});

const uploadHouseholdPhoto = vi.fn();
const deleteHouseholdPhoto = vi.fn();
const getHouseholdPhotoBytes = vi.fn();
vi.mock("@/lib/labs/pta/household-photo", () => ({
  uploadHouseholdPhoto: (...a: unknown[]) => uploadHouseholdPhoto(...a),
  deleteHouseholdPhoto: (...a: unknown[]) => deleteHouseholdPhoto(...a),
  getHouseholdPhotoBytes: (...a: unknown[]) => getHouseholdPhotoBytes(...a),
}));

// Deliberately NOT mocked away: if the route ever imports a signing helper
// again, that is the regression these tests are here to catch.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

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
  getHouseholdPhotoBytes.mockResolvedValue({ buffer: JPEG_BYTES, contentType: "image/jpeg", byteSize: JPEG_BYTES.byteLength });
});

describe("GET /api/mobile/pta/household/photo", () => {
  it("requires organizationId in the query string", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/api/mobile/pta/household/photo"));
    expect(res.status).toBe(400);
    expect(requireMobilePtaHouseholdAccess).not.toHaveBeenCalled();
  });

  it("returns the image BYTES, never a signed URL, key, or redirect", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    // Not a redirect to storage.
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("location")).toBeNull();
    // Nothing in the response names storage.
    const asText = body.toString("latin1") + JSON.stringify([...res.headers.entries()]);
    expect(asText).not.toContain("X-Amz-Signature");
    expect(asText).not.toContain("digitaloceanspaces");
    expect(asText).not.toContain("attachments/org-1");
  });

  it("sets privacy-safe caching and sniffing headers", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("resolves the household from the token, never from anything the client sends", async () => {
    const { GET } = await import("../route");
    // A forged household id in the query string must change nothing.
    await GET(new Request(`${url("/api/mobile/pta/household/photo")}&householdId=someone-elses-household`));
    expect(getHouseholdPhotoBytes).toHaveBeenCalledWith(ORG_ID, HOUSEHOLD_ID);
  });

  it("returns 404 when the household has no photo", async () => {
    getHouseholdPhotoBytes.mockResolvedValueOnce(null);
    const { GET } = await import("../route");
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns 404 once the photo has been removed, rather than serving stale bytes", async () => {
    const { GET, DELETE } = await import("../route");
    await DELETE(new Request(url("/api/mobile/pta/household/photo")));
    getHouseholdPhotoBytes.mockResolvedValueOnce(null);
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));
    expect(res.status).toBe(404);
  });

  it("propagates a bearer-auth failure without querying the attachment", async () => {
    requireMobilePtaHouseholdAccess.mockRejectedValueOnce(new MobileAuthError("Invalid or expired access token"));
    const { GET } = await import("../route");
    const res = await GET(new Request(url("/api/mobile/pta/household/photo")));
    expect(res.status).toBe(401);
    expect(getHouseholdPhotoBytes).not.toHaveBeenCalled();
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
