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

const listProperties = vi.fn();
const createProperty = vi.fn();
const getProperty = vi.fn();
const updateProperty = vi.fn();
const archiveProperty = vi.fn();
const reactivateProperty = vi.fn();
const assignPropertyResident = vi.fn();
const updatePropertyResident = vi.fn();
const endPropertyResidentRelationship = vi.fn();
const getPropertyResidentHistory = vi.fn();
const listActivePropertyResidents = vi.fn();
vi.mock("@/lib/hoa/properties", () => ({
  listProperties: (...a: unknown[]) => listProperties(...a),
  createProperty: (...a: unknown[]) => createProperty(...a),
  getProperty: (...a: unknown[]) => getProperty(...a),
  updateProperty: (...a: unknown[]) => updateProperty(...a),
  archiveProperty: (...a: unknown[]) => archiveProperty(...a),
  reactivateProperty: (...a: unknown[]) => reactivateProperty(...a),
  assignPropertyResident: (...a: unknown[]) => assignPropertyResident(...a),
  updatePropertyResident: (...a: unknown[]) => updatePropertyResident(...a),
  endPropertyResidentRelationship: (...a: unknown[]) => endPropertyResidentRelationship(...a),
  getPropertyResidentHistory: (...a: unknown[]) => getPropertyResidentHistory(...a),
  listActivePropertyResidents: (...a: unknown[]) => listActivePropertyResidents(...a),
}));

import { GET as listGet, POST as createPost } from "@/app/api/mobile/admin/hoa/properties/route";
import { GET as detailGet, PATCH as detailPatch } from "@/app/api/mobile/admin/hoa/properties/[propertyId]/route";
import { POST as archivePost } from "@/app/api/mobile/admin/hoa/properties/[propertyId]/archive/route";
import { POST as reactivatePost } from "@/app/api/mobile/admin/hoa/properties/[propertyId]/reactivate/route";
import { GET as residentsGet, POST as residentsPost } from "@/app/api/mobile/admin/hoa/properties/[propertyId]/residents/route";
import { PATCH as residentPatch } from "@/app/api/mobile/admin/hoa/properties/[propertyId]/residents/[residentId]/route";
import { POST as residentEndPost } from "@/app/api/mobile/admin/hoa/properties/[propertyId]/residents/[residentId]/end/route";

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
function propertyParams() {
  return { params: Promise.resolve({ propertyId: "property-1" }) };
}
function residentParams() {
  return { params: Promise.resolve({ propertyId: "property-1", residentId: "resident-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/hoa/properties", () => {
  it("returns 403 without manageHoaProperties", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: [] });

    const response = await listGet(getReq());
    expect(response.status).toBe(403);
    expect(listProperties).not.toHaveBeenCalled();
  });

  it("returns 403 without hoa:properties:read even with manageHoaProperties", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "FINANCE", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:residents:read"]);

    const response = await listGet(getReq());
    expect(response.status).toBe(403);
    expect(listProperties).not.toHaveBeenCalled();
  });

  it("lists properties scoped to the organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:read"]);
    listProperties.mockResolvedValueOnce({ properties: [], total: 0, take: 50, skip: 0 });

    const response = await listGet(getReq("organizationId=org-a&search=Main"));
    expect(response.status).toBe(200);
    expect(listProperties).toHaveBeenCalledWith("org-a", expect.objectContaining({ search: "Main" }));
  });
});

describe("POST /api/mobile/admin/hoa/properties", () => {
  it("rejects a crafted organizationId, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    await createPost(bodyReq({ organizationId: "org-victim", addressLine1: "123 Main St" }));

    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("requires hoa:properties:write, distinct from read", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "READ_ONLY", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:read"]);

    const response = await createPost(bodyReq({ organizationId: "org-a", addressLine1: "123 Main St" }));
    expect(response.status).toBe(403);
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("creates a property via the shared createProperty() service", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:write"]);
    createProperty.mockResolvedValueOnce({ id: "property-new" });

    const response = await createPost(bodyReq({ organizationId: "org-a", addressLine1: "123 Main St" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("property-new");
  });
});

describe("GET /api/mobile/admin/hoa/properties/[propertyId]", () => {
  it("delegates to getProperty with tenant scoping", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:read"]);
    getProperty.mockResolvedValueOnce({ id: "property-1" });

    const response = await detailGet(getReq(), propertyParams());
    expect(response.status).toBe(200);
    expect(getProperty).toHaveBeenCalledWith("org-a", "property-1");
  });
});

describe("PATCH /api/mobile/admin/hoa/properties/[propertyId]", () => {
  it("requires hoa:properties:write", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "READ_ONLY", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:read"]);

    const response = await detailPatch(bodyReq({ organizationId: "org-a", displayName: "Clubhouse" }, "PATCH"), propertyParams());
    expect(response.status).toBe(403);
    expect(updateProperty).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/admin/hoa/properties/[propertyId]/archive and /reactivate", () => {
  it("archives a property", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:write"]);
    archiveProperty.mockResolvedValueOnce({ id: "property-1", status: "INACTIVE" });

    const response = await archivePost(bodyReq({ organizationId: "org-a" }), propertyParams());
    expect(response.status).toBe(200);
    expect(archiveProperty).toHaveBeenCalledWith("org-a", "property-1", expect.objectContaining({ actorUserId: "user-1" }));
  });

  it("reactivates a property", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:write"]);
    reactivateProperty.mockResolvedValueOnce({ id: "property-1", status: "ACTIVE" });

    const response = await reactivatePost(bodyReq({ organizationId: "org-a" }), propertyParams());
    expect(response.status).toBe(200);
    expect(reactivateProperty).toHaveBeenCalledWith("org-a", "property-1", expect.objectContaining({ actorUserId: "user-1" }));
  });
});

describe("GET/POST /api/mobile/admin/hoa/properties/[propertyId]/residents", () => {
  it("returns 403 without hoa:residents:read, distinct from hoa:properties:read", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:properties:read"]);

    const response = await residentsGet(getReq(), propertyParams());
    expect(response.status).toBe(403);
    expect(listActivePropertyResidents).not.toHaveBeenCalled();
  });

  it("lists active residents by default", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:residents:read"]);
    listActivePropertyResidents.mockResolvedValueOnce([]);

    const response = await residentsGet(getReq(), propertyParams());
    expect(response.status).toBe(200);
    expect(listActivePropertyResidents).toHaveBeenCalledWith("org-a", "property-1");
    expect(getPropertyResidentHistory).not.toHaveBeenCalled();
  });

  it("lists full history when ?history=true", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:residents:read"]);
    getPropertyResidentHistory.mockResolvedValueOnce([]);

    const response = await residentsGet(getReq("organizationId=org-a&history=true"), propertyParams());
    expect(response.status).toBe(200);
    expect(getPropertyResidentHistory).toHaveBeenCalledWith("org-a", "property-1");
  });

  it("requires hoa:residents:write to assign a resident", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:residents:read"]);

    const response = await residentsPost(bodyReq({ organizationId: "org-a", orgMemberId: "member-1", relationshipType: "OWNER" }), propertyParams());
    expect(response.status).toBe(403);
    expect(assignPropertyResident).not.toHaveBeenCalled();
  });

  it("assigns a resident when authorized", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:residents:write"]);
    assignPropertyResident.mockResolvedValueOnce({ id: "resident-1" });

    const response = await residentsPost(bodyReq({ organizationId: "org-a", orgMemberId: "member-1", relationshipType: "OWNER" }), propertyParams());
    expect(response.status).toBe(201);
  });
});

describe("PATCH/POST resident sub-routes", () => {
  it("updates a resident relationship", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:residents:write"]);
    updatePropertyResident.mockResolvedValueOnce({ id: "resident-1" });

    const response = await residentPatch(bodyReq({ organizationId: "org-a", isPrimaryContact: true }, "PATCH"), residentParams());
    expect(response.status).toBe(200);
    expect(updatePropertyResident).toHaveBeenCalledWith("org-a", "resident-1", expect.objectContaining({ isPrimaryContact: true }));
  });

  it("ends a resident relationship", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["manageHoaProperties"] });
    getEffectivePermissions.mockResolvedValueOnce(["hoa:residents:write"]);
    endPropertyResidentRelationship.mockResolvedValueOnce({ id: "resident-1", status: "ENDED" });

    const response = await residentEndPost(bodyReq({ organizationId: "org-a" }), residentParams());
    expect(response.status).toBe(200);
    expect(endPropertyResidentRelationship).toHaveBeenCalledWith("org-a", "resident-1", expect.objectContaining({ actorUserId: "user-1" }));
  });
});
