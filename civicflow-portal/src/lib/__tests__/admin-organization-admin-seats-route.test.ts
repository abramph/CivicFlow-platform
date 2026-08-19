import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args),
  };
});

const requireRateLimit = vi.fn().mockResolvedValue(null);
vi.mock("@/lib/rate-limit", () => ({
  requireRateLimit: (...args: unknown[]) => requireRateLimit(...args),
}));

const getAdminSeatOverrideDetail = vi.fn();
const setAdminSeatOverride = vi.fn();
const removeAdminSeatOverride = vi.fn();
vi.mock("@/lib/admin-seat-override", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin-seat-override")>();
  return {
    ...actual,
    getAdminSeatOverrideDetail: (...args: unknown[]) => getAdminSeatOverrideDetail(...args),
    setAdminSeatOverride: (...args: unknown[]) => setAdminSeatOverride(...args),
    removeAdminSeatOverride: (...args: unknown[]) => removeAdminSeatOverride(...args),
  };
});

import { GET, PUT, DELETE } from "@/app/api/admin/organizations/[organizationId]/admin-seats/route";

function ctx(organizationId: string) {
  return { params: Promise.resolve({ organizationId }) };
}
function putReq(body: unknown) {
  return new Request("https://portal.test/api/admin/organizations/org-1/admin-seats", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function deleteReq(body: unknown) {
  return new Request("https://portal.test/api/admin/organizations/org-1/admin-seats", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const authed = { session: { userId: "admin-1", userEmail: "admin@aphtechgroup.com" } };

beforeEach(() => {
  requireSuperAdmin.mockReset();
  requireRateLimit.mockClear();
  getAdminSeatOverrideDetail.mockReset();
  setAdminSeatOverride.mockReset();
  removeAdminSeatOverride.mockReset();
});

describe("GET /api/admin/organizations/[organizationId]/admin-seats", () => {
  it("requires super-admin platform access", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Not a platform super-admin"));
    const response = await GET(new Request("https://portal.test/x"), ctx("org-1"));
    expect(response.status).toBe(403);
    expect(getAdminSeatOverrideDetail).not.toHaveBeenCalled();
  });

  it("returns the seat detail for an authorized platform admin", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    getAdminSeatOverrideDetail.mockResolvedValueOnce({ usedAdminSeats: 2, effectiveAdminSeatLimit: 10 });
    const response = await GET(new Request("https://portal.test/x"), ctx("org-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ usedAdminSeats: 2, effectiveAdminSeatLimit: 10 });
    expect(getAdminSeatOverrideDetail).toHaveBeenCalledWith("org-1");
  });
});

describe("PUT /api/admin/organizations/[organizationId]/admin-seats", () => {
  it("requires super-admin platform access", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Not a platform super-admin"));
    const response = await PUT(putReq({ newOverride: 5, reason: "x", expiresAt: null }), ctx("org-1"));
    expect(response.status).toBe(403);
    expect(setAdminSeatOverride).not.toHaveBeenCalled();
  });

  it("rejects a negative newOverride at the schema layer before reaching business logic", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await PUT(putReq({ newOverride: -3, reason: "x", expiresAt: null }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(setAdminSeatOverride).not.toHaveBeenCalled();
  });

  it("rejects a missing reason at the schema layer", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await PUT(putReq({ newOverride: 5, reason: "", expiresAt: null }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(setAdminSeatOverride).not.toHaveBeenCalled();
  });

  it("passes the actor's session identity through to setAdminSeatOverride, never trusting a client-supplied actor", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    setAdminSeatOverride.mockResolvedValueOnce({ before: 0, after: 5 });
    const response = await PUT(putReq({ newOverride: 5, reason: "Grant", expiresAt: null }), ctx("org-1"));
    expect(response.status).toBe(200);
    expect(setAdminSeatOverride).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        newOverride: 5,
        reason: "Grant",
        actorUserId: "admin-1",
        actorEmail: "admin@aphtechgroup.com",
      })
    );
  });

  it("converts a provided expiresAt string into a real Date before calling business logic", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    setAdminSeatOverride.mockResolvedValueOnce({ before: 0, after: 5 });
    await PUT(putReq({ newOverride: 5, reason: "Grant", expiresAt: "2027-01-01" }), ctx("org-1"));
    const call = setAdminSeatOverride.mock.calls[0][0];
    expect(call.expiresAt).toBeInstanceOf(Date);
  });
});

describe("DELETE /api/admin/organizations/[organizationId]/admin-seats", () => {
  it("requires super-admin platform access", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Not a platform super-admin"));
    const response = await DELETE(deleteReq({ reason: "x" }), ctx("org-1"));
    expect(response.status).toBe(403);
    expect(removeAdminSeatOverride).not.toHaveBeenCalled();
  });

  it("rejects a missing reason at the schema layer", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await DELETE(deleteReq({ reason: "" }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(removeAdminSeatOverride).not.toHaveBeenCalled();
  });

  it("removes the override using the actor's real session identity", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    removeAdminSeatOverride.mockResolvedValueOnce({ before: 5 });
    const response = await DELETE(deleteReq({ reason: "Cleanup" }), ctx("org-1"));
    expect(response.status).toBe(200);
    expect(removeAdminSeatOverride).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", reason: "Cleanup", actorUserId: "admin-1" })
    );
  });
});
