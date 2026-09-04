import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * build-26 Phase E -- officer-facing family-photo route. POST/DELETE reuse
 * the SAME pta:households:manage permission as every other household edit
 * (no new grant). GET is dual-audience: an officer with pta:directory:read,
 * OR the household's own linked parent -- proven here by simulating both
 * a directory-reading officer AND a permission-less parent hitting the
 * exact same URL for their own household.
 */

const requireOrganization = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requireOrganization: (...a: unknown[]) => requireOrganization(...a) };
});

const requirePtaAccess = vi.fn();
const requirePtaVertical = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaAccess: (...a: unknown[]) => requirePtaAccess(...a),
  requirePtaVertical: (...a: unknown[]) => requirePtaVertical(...a),
}));

const uploadHouseholdPhoto = vi.fn();
const deleteHouseholdPhoto = vi.fn();
const getHouseholdPhotoBytes = vi.fn();
vi.mock("@/lib/labs/pta/household-photo", () => ({
  uploadHouseholdPhoto: (...a: unknown[]) => uploadHouseholdPhoto(...a),
  deleteHouseholdPhoto: (...a: unknown[]) => deleteHouseholdPhoto(...a),
  getHouseholdPhotoBytes: (...a: unknown[]) => getHouseholdPhotoBytes(...a),
}));

const findFirstHouseholdAdult = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstHouseholdAdult(...a) } },
}));

// Storage is deliberately NOT mocked here: this route must not reach for a
// signing helper at all any more, and an unmocked import would surface that.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

import { PtaError } from "@/lib/labs/pta/errors";

const HOUSEHOLD_ID = "household-1";
const ORG_ID = "org-1";

function multipartRequest(file: File | null): Request {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request(`https://portal.test/api/labs/pta/households/${HOUSEHOLD_ID}/photo`, { method: "POST", body: form });
}

function params() {
  return { params: Promise.resolve({ householdId: HOUSEHOLD_ID }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePtaAccess.mockResolvedValue({ organizationId: ORG_ID, session: { userId: "officer-1", userEmail: "officer@example.org" } });
  requireOrganization.mockResolvedValue({
    organizationId: ORG_ID,
    session: { userId: "officer-1", userEmail: "officer@example.org" },
    can: (permission: string) => permission === "pta:directory:read",
  });
  requirePtaVertical.mockResolvedValue({ primaryVertical: "PTA", status: "active" });
  uploadHouseholdPhoto.mockResolvedValue({ photoUrl: `/api/labs/pta/households/${HOUSEHOLD_ID}/photo`, byteSize: 100, width: 10, height: 10 });
  deleteHouseholdPhoto.mockResolvedValue(undefined);
  getHouseholdPhotoBytes.mockResolvedValue({ buffer: JPEG_BYTES, contentType: "image/jpeg", byteSize: JPEG_BYTES.byteLength });
  findFirstHouseholdAdult.mockResolvedValue(null);
});

describe("POST /api/labs/pta/households/[householdId]/photo", () => {
  it("requires pta:households:manage before touching the request body", async () => {
    requirePtaAccess.mockRejectedValueOnce(new PtaError("PTA_VALIDATION_ERROR", "forbidden"));
    const { POST } = await import("../route");
    const req = new Request("https://portal.test/x", { method: "POST", body: "garbage", headers: { "content-type": "multipart/form-data; boundary=x" } });
    const res = await POST(req, params());
    expect(res.status).not.toBe(200);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("uploads using the URL's householdId once authorized", async () => {
    const { POST } = await import("../route");
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(multipartRequest(file), params());
    expect(res.status).toBe(200);
    expect(uploadHouseholdPhoto).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_ID, householdId: HOUSEHOLD_ID, actorUserId: "officer-1" }));
  });

  it("rejects an oversized declared Content-Length with 413", async () => {
    const { POST } = await import("../route");
    const req = new Request("https://portal.test/x", {
      method: "POST",
      body: "x",
      headers: { "content-length": String(15 * 1024 * 1024 + 1), "content-type": "multipart/form-data; boundary=x" },
    });
    const res = await POST(req, params());
    expect(res.status).toBe(413);
  });
});

describe("DELETE /api/labs/pta/households/[householdId]/photo", () => {
  it("deletes using pta:households:manage and the URL's householdId", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE(new Request("https://portal.test/x"), params());
    expect(res.status).toBe(200);
    expect(deleteHouseholdPhoto).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_ID, householdId: HOUSEHOLD_ID }));
  });
});

describe("GET /api/labs/pta/households/[householdId]/photo -- dual-audience authorization", () => {
  it("allows an officer holding pta:directory:read and serves the BYTES, never a redirect to storage", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(findFirstHouseholdAdult).not.toHaveBeenCalled(); // officer path short-circuits before the linkage lookup
  });

  it("never puts a storage host or object key anywhere in the response", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    const headers = JSON.stringify([...res.headers.entries()]);
    expect(headers).not.toContain("digitaloceanspaces");
    expect(headers).not.toContain("X-Amz-Signature");
    expect(headers).not.toContain("attachments/org-1");
  });

  it("allows a parent linked to THIS household even though they hold no permission at all", async () => {
    requireOrganization.mockResolvedValueOnce({
      organizationId: ORG_ID,
      session: { userId: "parent-1", userEmail: "parent@example.org" },
      can: () => false, // ordinary parent -- no Permission grants whatsoever
    });
    findFirstHouseholdAdult.mockResolvedValueOnce({ id: "adult-1" });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    expect(res.status).toBe(200);
    expect(findFirstHouseholdAdult).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, userId: "parent-1", householdId: HOUSEHOLD_ID },
      select: { id: true },
    });
  });

  it("denies a parent linked to a DIFFERENT household (never trusts the URL alone)", async () => {
    requireOrganization.mockResolvedValueOnce({
      organizationId: ORG_ID,
      session: { userId: "other-parent", userEmail: "other@example.org" },
      can: () => false,
    });
    findFirstHouseholdAdult.mockResolvedValueOnce(null); // not linked to household-1
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    expect(res.status).toBe(404);
    expect(getHouseholdPhotoBytes).not.toHaveBeenCalled();
  });

  it("denies a caller with neither directory-read permission nor household linkage", async () => {
    requireOrganization.mockResolvedValueOnce({ organizationId: ORG_ID, session: { userId: "stranger", userEmail: "s@example.org" }, can: () => false });
    findFirstHouseholdAdult.mockResolvedValueOnce(null);
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    expect(res.status).toBe(404);
  });

  it("returns 404 when authorized but no photo is on file", async () => {
    getHouseholdPhotoBytes.mockResolvedValueOnce(null);
    const { GET } = await import("../route");
    const res = await GET(new Request("https://portal.test/x"), params());
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
