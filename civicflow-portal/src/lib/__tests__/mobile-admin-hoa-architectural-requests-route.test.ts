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

// This suite tests mobile-admin capability/permission gating, not the
// subscription gate — assume every organization is allowed.
vi.mock("@/lib/subscription-gate", () => ({
  assertOrganizationAccess: vi.fn().mockResolvedValue({
    allowed: true,
    reason: null,
    trialEndsAt: null,
    subscriptionStatus: null,
    billingExempt: false,
  }),
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const listArchitecturalRequests = vi.fn();
const getArchitecturalRequestDetail = vi.fn();
const addArchitecturalRequestComment = vi.fn();
const transitionArchitecturalRequestStatus = vi.fn();
vi.mock("@/lib/hoa/architectural-requests", () => ({
  listArchitecturalRequests: (...a: unknown[]) => listArchitecturalRequests(...a),
  getArchitecturalRequestDetail: (...a: unknown[]) => getArchitecturalRequestDetail(...a),
  addArchitecturalRequestComment: (...a: unknown[]) => addArchitecturalRequestComment(...a),
  // Included only so a test can assert it's never imported/called by any
  // mobile route — see the "never calls decide" test below.
  transitionArchitecturalRequestStatus: (...a: unknown[]) => transitionArchitecturalRequestStatus(...a),
}));

import { GET as listGet } from "@/app/api/mobile/admin/hoa/architectural-requests/route";
import { GET as detailGet } from "@/app/api/mobile/admin/hoa/architectural-requests/[requestId]/route";
import { POST as commentPost } from "@/app/api/mobile/admin/hoa/architectural-requests/[requestId]/comments/route";
import * as fs from "node:fs";
import * as path from "node:path";

function getReq(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/x?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function bodyReq(body: Record<string, unknown>) {
  return new Request("https://portal.test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function requestParams() {
  return { params: Promise.resolve({ requestId: "request-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/hoa/architectural-requests", () => {
  it("returns 403 without manageHoaArchitecturalRequests", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: [] });

    const response = await listGet(getReq());
    expect(response.status).toBe(403);
    expect(listArchitecturalRequests).not.toHaveBeenCalled();
  });

  it("lists requests scoped to the organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaArchitecturalRequests"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:architectural-requests:read"]);
    listArchitecturalRequests.mockResolvedValueOnce([]);

    const response = await listGet(getReq("organizationId=org-a&status=IN_REVIEW"));
    expect(response.status).toBe(200);
    expect(listArchitecturalRequests).toHaveBeenCalledWith("org-a", expect.objectContaining({ status: "IN_REVIEW" }));
  });
});

describe("GET /api/mobile/admin/hoa/architectural-requests/[requestId]", () => {
  it("delegates to getArchitecturalRequestDetail with tenant scoping", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaArchitecturalRequests"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:architectural-requests:read"]);
    getArchitecturalRequestDetail.mockResolvedValueOnce({ id: "request-1" });

    const response = await detailGet(getReq(), requestParams());
    expect(response.status).toBe(200);
    expect(getArchitecturalRequestDetail).toHaveBeenCalledWith("org-a", "request-1");
  });
});

describe("POST /api/mobile/admin/hoa/architectural-requests/[requestId]/comments", () => {
  it("returns 403 for a READ-only caller — comments require REVIEW, not READ", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "READ_ONLY", adminCapabilities: ["manageHoaArchitecturalRequests"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:architectural-requests:read"]);

    const response = await commentPost(bodyReq({ organizationId: "org-a", body: "Looks reasonable" }), requestParams());
    expect(response.status).toBe(403);
    expect(addArchitecturalRequestComment).not.toHaveBeenCalled();
  });

  it("posts a private-by-default comment for a caller holding REVIEW", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaArchitecturalRequests"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:architectural-requests:review"]);
    addArchitecturalRequestComment.mockResolvedValueOnce({ id: "comment-1", isPrivate: true });

    const response = await commentPost(bodyReq({ organizationId: "org-a", body: "Looks reasonable" }), requestParams());
    expect(response.status).toBe(201);
    expect(addArchitecturalRequestComment).toHaveBeenCalledWith(expect.objectContaining({ isPrivate: true }));
  });
});

describe("mobile architectural-requests route tree never exposes a decision", () => {
  it("no route file under api/mobile/admin/hoa/architectural-requests imports transitionArchitecturalRequestStatus or checks HOA_ARCHITECTURAL_REQUESTS_DECIDE", () => {
    const dir = path.join(process.cwd(), "src/app/api/mobile/admin/hoa/architectural-requests");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") files.push(full);
      }
    };
    walk(dir);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Strip /** ... */ and // ... doc comments before checking — this
      // route.ts's own doc comment names both symbols by way of explaining
      // why they're absent from the executable code, so a naive substring
      // check would false-positive on the documentation itself.
      const contents = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(contents).not.toMatch(/transitionArchitecturalRequestStatus/);
      expect(contents).not.toMatch(/HOA_ARCHITECTURAL_REQUESTS_DECIDE/);
    }
  });
});
