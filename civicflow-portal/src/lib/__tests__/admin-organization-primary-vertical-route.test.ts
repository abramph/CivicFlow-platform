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

const previewPrimaryVerticalChange = vi.fn();
const changeOrganizationPrimaryVertical = vi.fn();
vi.mock("@/lib/platform-operations/organizations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-operations/organizations")>();
  return {
    ...actual,
    previewPrimaryVerticalChange: (...args: unknown[]) => previewPrimaryVerticalChange(...args),
    changeOrganizationPrimaryVertical: (...args: unknown[]) => changeOrganizationPrimaryVertical(...args),
  };
});

import { GET, PUT } from "@/app/api/admin/organizations/[organizationId]/primary-vertical/route";

function ctx(organizationId: string) {
  return { params: Promise.resolve({ organizationId }) };
}
function getReq(qs: string) {
  return new Request(`https://portal.test/api/admin/organizations/org-1/primary-vertical${qs}`);
}
function putReq(body: unknown) {
  return new Request("https://portal.test/api/admin/organizations/org-1/primary-vertical", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const authed = { session: { userId: "admin-1", userEmail: "admin@aphtechnologies.example" } };

describe("GET /api/admin/organizations/[organizationId]/primary-vertical", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireRateLimit.mockClear();
    previewPrimaryVerticalChange.mockReset();
    changeOrganizationPrimaryVertical.mockReset();
  });

  it("requires super-admin platform access", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Not a platform super-admin"));
    const response = await GET(getReq("?to=PTA"), ctx("org-1"));
    expect(response.status).toBe(403);
    expect(previewPrimaryVerticalChange).not.toHaveBeenCalled();
  });

  it("rejects a missing/invalid target vertical", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await GET(getReq(""), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(previewPrimaryVerticalChange).not.toHaveBeenCalled();
  });

  it("returns the impact preview for a valid target", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    previewPrimaryVerticalChange.mockResolvedValueOnce({
      organizationId: "org-1",
      currentVertical: "PTA",
      proposedVertical: "COMMUNITY",
      dormantOnChange: [{ label: "Households", count: 5 }],
      ptaLabsEnrollmentMismatch: false,
    });

    const response = await GET(getReq("?to=COMMUNITY"), ctx("org-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.dormantOnChange).toEqual([{ label: "Households", count: 5 }]);
    expect(previewPrimaryVerticalChange).toHaveBeenCalledWith("org-1", "COMMUNITY");
  });
});

describe("PUT /api/admin/organizations/[organizationId]/primary-vertical", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireRateLimit.mockClear();
    changeOrganizationPrimaryVertical.mockReset();
  });

  it("rejects a request missing the explicit confirm flag", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await PUT(putReq({ newVertical: "COMMUNITY" }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(changeOrganizationPrimaryVertical).not.toHaveBeenCalled();
  });

  it("rejects an invalid vertical value", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    const response = await PUT(putReq({ newVertical: "NONPROFIT", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(400);
    expect(changeOrganizationPrimaryVertical).not.toHaveBeenCalled();
  });

  it("applies the change and passes the acting admin's identity through for audit attribution", async () => {
    requireSuperAdmin.mockResolvedValueOnce(authed);
    changeOrganizationPrimaryVertical.mockResolvedValueOnce({
      organizationId: "org-1",
      previousVertical: "PTA",
      newVertical: "COMMUNITY",
    });

    const response = await PUT(putReq({ newVertical: "COMMUNITY", reason: "Reclassifying test org", confirm: true }), ctx("org-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.newVertical).toBe("COMMUNITY");
    expect(changeOrganizationPrimaryVertical).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        newVertical: "COMMUNITY",
        actorUserId: "admin-1",
        actorEmail: "admin@aphtechnologies.example",
        reason: "Reclassifying test org",
      })
    );
  });

  it("is rate-limited", async () => {
    requireRateLimit.mockResolvedValueOnce(Response.json({ ok: false, error: "Rate limit exceeded" }, { status: 429 }));
    const response = await PUT(putReq({ newVertical: "COMMUNITY", confirm: true }), ctx("org-1"));
    expect(response.status).toBe(429);
    expect(requireSuperAdmin).not.toHaveBeenCalled();
  });
});
