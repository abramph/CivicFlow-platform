import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileAuth = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
  MobileAuthError: class MobileAuthError extends Error {
    status = 401;
  },
  MobileForbiddenError: class MobileForbiddenError extends Error {
    status = 403;
  },
}));

const resolveMobileAdminCapabilities = vi.fn();
vi.mock("@/lib/mobile-admin", () => ({
  resolveMobileAdminCapabilities: (...args: unknown[]) => resolveMobileAdminCapabilities(...args),
}));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const listViolations = vi.fn();
const createViolationDraft = vi.fn();
const getViolationDetail = vi.fn();
const updateViolationDraft = vi.fn();
const issueViolation = vi.fn();
const transitionViolationStatus = vi.fn();
const addViolationComment = vi.fn();
vi.mock("@/lib/hoa/violations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hoa/violations")>();
  return {
    isTerminalStatus: actual.isTerminalStatus,
    listViolations: (...a: unknown[]) => listViolations(...a),
    createViolationDraft: (...a: unknown[]) => createViolationDraft(...a),
    getViolationDetail: (...a: unknown[]) => getViolationDetail(...a),
    updateViolationDraft: (...a: unknown[]) => updateViolationDraft(...a),
    issueViolation: (...a: unknown[]) => issueViolation(...a),
    transitionViolationStatus: (...a: unknown[]) => transitionViolationStatus(...a),
    addViolationComment: (...a: unknown[]) => addViolationComment(...a),
  };
});

import { GET as listGet, POST as createPost } from "@/app/api/mobile/admin/hoa/violations/route";
import { GET as detailGet, PATCH as detailPatch } from "@/app/api/mobile/admin/hoa/violations/[violationId]/route";
import { POST as issuePost } from "@/app/api/mobile/admin/hoa/violations/[violationId]/issue/route";
import { POST as transitionPost } from "@/app/api/mobile/admin/hoa/violations/[violationId]/transition/route";
import { POST as commentPost } from "@/app/api/mobile/admin/hoa/violations/[violationId]/comments/route";

function getReq(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/x?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function bodyReq(body: Record<string, unknown>, method = "POST") {
  return new Request("https://portal.test/x", {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function violationParams() {
  return { params: Promise.resolve({ violationId: "violation-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/hoa/violations", () => {
  it("returns 403 without manageHoaViolations", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: [] });

    const response = await listGet(getReq());
    expect(response.status).toBe(403);
    expect(listViolations).not.toHaveBeenCalled();
  });

  it("lists violations scoped to the organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:read"]);
    listViolations.mockResolvedValueOnce([]);

    const response = await listGet(getReq("organizationId=org-a&status=ISSUED"));
    expect(response.status).toBe(200);
    expect(listViolations).toHaveBeenCalledWith("org-a", expect.objectContaining({ status: "ISSUED" }));
  });

  it("ignores an invalid status filter rather than passing it through", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:read"]);
    listViolations.mockResolvedValueOnce([]);

    await listGet(getReq("organizationId=org-a&status=bogus"));
    expect(listViolations).toHaveBeenCalledWith("org-a", expect.objectContaining({ status: undefined }));
  });
});

describe("POST /api/mobile/admin/hoa/violations", () => {
  it("requires hoa:violations:write to create a draft", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:read"]);

    const response = await createPost(bodyReq({ organizationId: "org-a", propertyId: "property-1", violationType: "Fence", description: "Fence too high" }));
    expect(response.status).toBe(403);
    expect(createViolationDraft).not.toHaveBeenCalled();
  });

  it("creates a draft when authorized", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:write"]);
    createViolationDraft.mockResolvedValueOnce({ id: "violation-new", status: "DRAFT" });

    const response = await createPost(bodyReq({ organizationId: "org-a", propertyId: "property-1", violationType: "Fence", description: "Fence too high" }));
    expect(response.status).toBe(201);
  });
});

describe("GET /api/mobile/admin/hoa/violations/[violationId]", () => {
  it("delegates to getViolationDetail with tenant scoping", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:read"]);
    getViolationDetail.mockResolvedValueOnce({ id: "violation-1" });

    const response = await detailGet(getReq(), violationParams());
    expect(response.status).toBe(200);
    expect(getViolationDetail).toHaveBeenCalledWith("org-a", "violation-1");
  });
});

describe("PATCH /api/mobile/admin/hoa/violations/[violationId]", () => {
  it("requires hoa:violations:write", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:read"]);

    const response = await detailPatch(bodyReq({ organizationId: "org-a", description: "Updated" }, "PATCH"), violationParams());
    expect(response.status).toBe(403);
    expect(updateViolationDraft).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/admin/hoa/violations/[violationId]/issue", () => {
  it("issues a violation via hoa:violations:write", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:write"]);
    issueViolation.mockResolvedValueOnce({ id: "violation-1", status: "ISSUED" });

    const response = await issuePost(bodyReq({ organizationId: "org-a", noticeBody: "You are in violation" }), violationParams());
    expect(response.status).toBe(200);
  });
});

describe("POST /api/mobile/admin/hoa/violations/[violationId]/transition — dynamic review/resolve gate", () => {
  it("requires only hoa:violations:review for ACKNOWLEDGED (STAFF-reachable)", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:review"]);
    transitionViolationStatus.mockResolvedValueOnce({ id: "violation-1", status: "ACKNOWLEDGED" });

    const response = await transitionPost(bodyReq({ organizationId: "org-a", toStatus: "ACKNOWLEDGED" }), violationParams());
    expect(response.status).toBe(200);
  });

  it("requires only hoa:violations:review for CURED, even though it's terminal", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:review"]);
    transitionViolationStatus.mockResolvedValueOnce({ id: "violation-1", status: "CURED" });

    const response = await transitionPost(bodyReq({ organizationId: "org-a", toStatus: "CURED" }), violationParams());
    expect(response.status).toBe(200);
  });

  it("rejects RESOLVED for a STAFF role holding only review, not resolve", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:review"]);

    const response = await transitionPost(bodyReq({ organizationId: "org-a", toStatus: "RESOLVED" }), violationParams());
    expect(response.status).toBe(403);
    expect(transitionViolationStatus).not.toHaveBeenCalled();
  });

  it("allows RESOLVED for a role holding hoa:violations:resolve", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "ORG_ADMIN", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:resolve"]);
    transitionViolationStatus.mockResolvedValueOnce({ id: "violation-1", status: "RESOLVED" });

    const response = await transitionPost(bodyReq({ organizationId: "org-a", toStatus: "RESOLVED" }), violationParams());
    expect(response.status).toBe(200);
  });

  it("rejects DISMISSED without resolve authority", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:review"]);

    const response = await transitionPost(bodyReq({ organizationId: "org-a", toStatus: "DISMISSED" }), violationParams());
    expect(response.status).toBe(403);
  });
});

describe("POST /api/mobile/admin/hoa/violations/[violationId]/comments", () => {
  it("is gated on hoa:violations:write, not review/resolve", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:review"]);

    const response = await commentPost(bodyReq({ organizationId: "org-a", body: "Spoke with resident" }), violationParams());
    expect(response.status).toBe(403);
    expect(addViolationComment).not.toHaveBeenCalled();
  });

  it("adds a private-by-default comment", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaViolations"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:violations:write"]);
    addViolationComment.mockResolvedValueOnce({ id: "comment-1", isPrivate: true });

    const response = await commentPost(bodyReq({ organizationId: "org-a", body: "Spoke with resident" }), violationParams());
    expect(response.status).toBe(201);
    expect(addViolationComment).toHaveBeenCalledWith(expect.objectContaining({ isPrivate: true }));
  });
});
