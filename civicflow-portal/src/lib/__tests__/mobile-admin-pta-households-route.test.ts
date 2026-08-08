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

const listPtaHouseholds = vi.fn();
const createPtaHousehold = vi.fn();
const getPtaHousehold = vi.fn();
const updatePtaHousehold = vi.fn();
const deactivatePtaHousehold = vi.fn();
const addPtaHouseholdAdult = vi.fn();
const removePtaHouseholdAdult = vi.fn();
const addPtaStudent = vi.fn();
const deactivatePtaStudent = vi.fn();
vi.mock("@/lib/labs/pta/households", () => ({
  listPtaHouseholds: (...a: unknown[]) => listPtaHouseholds(...a),
  createPtaHousehold: (...a: unknown[]) => createPtaHousehold(...a),
  getPtaHousehold: (...a: unknown[]) => getPtaHousehold(...a),
  updatePtaHousehold: (...a: unknown[]) => updatePtaHousehold(...a),
  deactivatePtaHousehold: (...a: unknown[]) => deactivatePtaHousehold(...a),
  addPtaHouseholdAdult: (...a: unknown[]) => addPtaHouseholdAdult(...a),
  removePtaHouseholdAdult: (...a: unknown[]) => removePtaHouseholdAdult(...a),
  addPtaStudent: (...a: unknown[]) => addPtaStudent(...a),
  deactivatePtaStudent: (...a: unknown[]) => deactivatePtaStudent(...a),
}));

import { GET as listGet, POST as createPost } from "@/app/api/mobile/admin/pta/households/route";
import { GET as detailGet, PATCH as detailPatch, DELETE as detailDelete } from "@/app/api/mobile/admin/pta/households/[householdId]/route";
import { POST as addAdultPost } from "@/app/api/mobile/admin/pta/households/[householdId]/adults/route";
import { DELETE as removeAdultDelete } from "@/app/api/mobile/admin/pta/households/[householdId]/adults/[adultId]/route";
import { POST as addStudentPost } from "@/app/api/mobile/admin/pta/households/[householdId]/students/route";
import { DELETE as deactivateStudentDelete } from "@/app/api/mobile/admin/pta/households/[householdId]/students/[studentId]/route";

function listReq(qs = "organizationId=org-a") {
  return new Request(`https://portal.test/x?${qs}`, { headers: { Authorization: "Bearer test-token" } });
}
function bodyReq(body: Record<string, unknown>, method = "POST") {
  return new Request("https://portal.test/x", {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify(body),
  });
}
function householdParams() {
  return { params: Promise.resolve({ householdId: "household-1" }) };
}
function adultParams() {
  return { params: Promise.resolve({ householdId: "household-1", adultId: "adult-1" }) };
}
function studentParams() {
  return { params: Promise.resolve({ householdId: "household-1", studentId: "student-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ userId: "user-1", email: "officer@example.com" });
});

describe("GET /api/mobile/admin/pta/households", () => {
  it("returns 403 without managePtaHouseholds", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: [] });

    const response = await listGet(listReq());
    expect(response.status).toBe(403);
    expect(listPtaHouseholds).not.toHaveBeenCalled();
  });

  it("returns 403 without pta:directory:read even with managePtaHouseholds", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce([]);

    const response = await listGet(listReq());
    expect(response.status).toBe(403);
    expect(listPtaHouseholds).not.toHaveBeenCalled();
  });

  it("lists households scoped to the organization", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:directory:read"]);
    listPtaHouseholds.mockResolvedValueOnce([{ id: "household-1" }]);

    const response = await listGet(listReq("organizationId=org-a&search=Ada"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listPtaHouseholds).toHaveBeenCalledWith("org-a", expect.objectContaining({ search: "Ada" }));
    expect(body.data).toEqual([{ id: "household-1" }]);
  });
});

describe("POST /api/mobile/admin/pta/households", () => {
  it("rejects a crafted organizationId, resolved fresh per request", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: false, role: null, adminCapabilities: [] });

    await createPost(bodyReq({ organizationId: "org-victim", displayName: "Smith Family", schoolYear: "2026-2027" }));

    expect(resolveMobileAdminCapabilities).toHaveBeenCalledWith("org-victim", "user-1");
    expect(createPtaHousehold).not.toHaveBeenCalled();
  });

  it("requires pta:households:manage, distinct from pta:directory:read", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:directory:read"]);

    const response = await createPost(bodyReq({ organizationId: "org-a", displayName: "Smith Family", schoolYear: "2026-2027" }));
    expect(response.status).toBe(403);
    expect(createPtaHousehold).not.toHaveBeenCalled();
  });

  it("creates a household via the shared createPtaHousehold() service", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:households:manage"]);
    createPtaHousehold.mockResolvedValueOnce({ id: "household-new" });

    const response = await createPost(bodyReq({ organizationId: "org-a", displayName: "Smith Family", schoolYear: "2026-2027" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.id).toBe("household-new");
    expect(createPtaHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", displayName: "Smith Family", actorUserId: "user-1" })
    );
  });
});

describe("GET /api/mobile/admin/pta/households/[householdId]", () => {
  it("delegates to getPtaHousehold with tenant scoping", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:directory:read"]);
    getPtaHousehold.mockResolvedValueOnce({ id: "household-1" });

    const response = await detailGet(listReq(), householdParams());
    expect(response.status).toBe(200);
    expect(getPtaHousehold).toHaveBeenCalledWith("org-a", "household-1");
  });
});

describe("PATCH /api/mobile/admin/pta/households/[householdId]", () => {
  it("requires pta:households:manage", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:directory:read"]);

    const response = await detailPatch(bodyReq({ organizationId: "org-a", displayName: "Updated" }, "PATCH"), householdParams());
    expect(response.status).toBe(403);
    expect(updatePtaHousehold).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/mobile/admin/pta/households/[householdId]", () => {
  it("deactivates (soft delete) rather than hard-deleting", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:households:manage"]);
    deactivatePtaHousehold.mockResolvedValueOnce({ id: "household-1", status: "INACTIVE" });

    const response = await detailDelete(listReq(), householdParams());
    expect(response.status).toBe(200);
    expect(deactivatePtaHousehold).toHaveBeenCalledWith("org-a", "household-1", "user-1", "officer@example.com");
  });
});

describe("POST /api/mobile/admin/pta/households/[householdId]/adults", () => {
  it("never accepts a userId field, even if the client sends one", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:households:manage"]);
    addPtaHouseholdAdult.mockResolvedValueOnce({ id: "adult-1" });

    await addAdultPost(bodyReq({ organizationId: "org-a", name: "Jane Smith", userId: "user-injected" }), householdParams());

    expect(addPtaHouseholdAdult).toHaveBeenCalledWith(expect.not.objectContaining({ userId: expect.anything() }));
  });
});

describe("DELETE /api/mobile/admin/pta/households/[householdId]/adults/[adultId]", () => {
  it("delegates to removePtaHouseholdAdult (hard delete, matching web)", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:households:manage"]);

    const response = await removeAdultDelete(listReq(), adultParams());
    expect(response.status).toBe(200);
    expect(removePtaHouseholdAdult).toHaveBeenCalledWith("org-a", "household-1", "adult-1", "user-1", "officer@example.com");
  });
});

describe("POST /api/mobile/admin/pta/households/[householdId]/students", () => {
  it("requires pta:students:manage, distinct from pta:households:manage", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:households:manage"]);

    const response = await addStudentPost(bodyReq({ organizationId: "org-a", displayName: "Jamie Smith" }), householdParams());
    expect(response.status).toBe(403);
    expect(addPtaStudent).not.toHaveBeenCalled();
  });

  it("adds a student when authorized", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:students:manage"]);
    addPtaStudent.mockResolvedValueOnce({ id: "student-1" });

    const response = await addStudentPost(bodyReq({ organizationId: "org-a", displayName: "Jamie Smith" }), householdParams());
    expect(response.status).toBe(201);
  });
});

describe("DELETE /api/mobile/admin/pta/households/[householdId]/students/[studentId]", () => {
  it("deactivates (soft delete) via pta:students:manage", async () => {
    resolveMobileAdminCapabilities.mockResolvedValueOnce({ available: true, role: "STAFF", adminCapabilities: ["managePtaHouseholds"] });
    getEffectivePermissions.mockResolvedValueOnce(["pta:students:manage"]);
    deactivatePtaStudent.mockResolvedValueOnce({ id: "student-1", status: "INACTIVE" });

    const response = await deactivateStudentDelete(listReq(), studentParams());
    expect(response.status).toBe(200);
    expect(deactivatePtaStudent).toHaveBeenCalledWith("org-a", "household-1", "student-1", "user-1", "officer@example.com");
  });
});
