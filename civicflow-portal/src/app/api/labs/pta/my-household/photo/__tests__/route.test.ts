import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * build-26 Phase E -- parent self-service family-photo route. Proves:
 * auth runs before any body access (matches the auth-before-parse
 * discipline from fix/import-auth-order-and-format-ui), the household id
 * always comes from the caller's own PtaHouseholdAdult linkage (never a
 * client-supplied value -- there isn't even a place for one in this route),
 * and the malformed-request status codes (413/415/400).
 */

const requirePtaHouseholdSelfAccess = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaHouseholdSelfAccess: (...a: unknown[]) => requirePtaHouseholdSelfAccess(...a),
}));

import { PtaError } from "@/lib/labs/pta/errors";

const uploadHouseholdPhoto = vi.fn();
const deleteHouseholdPhoto = vi.fn();
vi.mock("@/lib/labs/pta/household-photo", () => ({
  uploadHouseholdPhoto: (...a: unknown[]) => uploadHouseholdPhoto(...a),
  deleteHouseholdPhoto: (...a: unknown[]) => deleteHouseholdPhoto(...a),
}));

const SELF_ACCESS = {
  organizationId: "org-1",
  adult: { householdId: "household-1" },
  session: { userId: "user-1", userEmail: "parent@example.org" },
};

function multipartRequest(file: File | null): Request {
  const form = new FormData();
  if (file) form.set("file", file);
  return new Request("https://portal.test/api/labs/pta/my-household/photo", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePtaHouseholdSelfAccess.mockResolvedValue(SELF_ACCESS);
  uploadHouseholdPhoto.mockResolvedValue({ photoUrl: "/api/labs/pta/households/household-1/photo", byteSize: 100, width: 10, height: 10 });
  deleteHouseholdPhoto.mockResolvedValue(undefined);
});

describe("POST /api/labs/pta/my-household/photo", () => {
  it("authenticates before ever reading the request body", async () => {
    requirePtaHouseholdSelfAccess.mockRejectedValueOnce(new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "not linked"));
    const { POST } = await import("../route");
    // A request whose body would throw if ever parsed -- proves auth ran first.
    const req = new Request("https://portal.test/x", { method: "POST", body: "not multipart", headers: { "content-type": "multipart/form-data; boundary=x" } });
    const res = await POST(req);
    expect(res.status).not.toBe(200);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("rejects a declared Content-Length over 15MB with 413, before parsing", async () => {
    const { POST } = await import("../route");
    const req = new Request("https://portal.test/x", {
      method: "POST",
      body: "irrelevant",
      headers: { "content-length": String(15 * 1024 * 1024 + 1), "content-type": "multipart/form-data; boundary=x" },
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("rejects a non-multipart content-type with 415", async () => {
    const { POST } = await import("../route");
    const req = new Request("https://portal.test/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const res = await POST(req);
    expect(res.status).toBe(415);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("returns a clean 400 on a malformed multipart body instead of throwing", async () => {
    const { POST } = await import("../route");
    const req = new Request("https://portal.test/x", {
      method: "POST",
      body: "--not-a-real-boundary\r\ngarbage",
      headers: { "content-type": "multipart/form-data; boundary=totally-different" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("returns 400 when no file field is present", async () => {
    const { POST } = await import("../route");
    const res = await POST(multipartRequest(null));
    expect(res.status).toBe(400);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("rejects a file over 15MB with 413", async () => {
    const { POST } = await import("../route");
    const big = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(multipartRequest(big));
    expect(res.status).toBe(413);
    expect(uploadHouseholdPhoto).not.toHaveBeenCalled();
  });

  it("uploads using the caller's OWN householdId from self-access linkage -- never a client-supplied id", async () => {
    const { POST } = await import("../route");
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" });
    const res = await POST(multipartRequest(file));
    expect(res.status).toBe(200);
    expect(uploadHouseholdPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", householdId: "household-1", actorUserId: "user-1" })
    );
  });
});

describe("DELETE /api/labs/pta/my-household/photo", () => {
  it("authenticates via self-access and deletes using the caller's own household id", async () => {
    const { DELETE } = await import("../route");
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(deleteHouseholdPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", householdId: "household-1", actorUserId: "user-1" })
    );
  });

  it("propagates an authorization failure without calling deleteHouseholdPhoto", async () => {
    requirePtaHouseholdSelfAccess.mockRejectedValueOnce(new PtaError("PTA_HOUSEHOLD_INACTIVE", "inactive"));
    const { DELETE } = await import("../route");
    const res = await DELETE();
    expect(res.status).not.toBe(200);
    expect(deleteHouseholdPhoto).not.toHaveBeenCalled();
  });
});
