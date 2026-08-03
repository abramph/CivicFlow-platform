import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

const requirePtaAccess = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaAccess: (...a: unknown[]) => requirePtaAccess(...a),
}));

const requireHoaPropertyWrite = vi.fn();
const requireHoaResidentWrite = vi.fn();
vi.mock("@/lib/hoa/guard", () => ({
  requireHoaPropertyWrite: (...a: unknown[]) => requireHoaPropertyWrite(...a),
  requireHoaResidentWrite: (...a: unknown[]) => requireHoaResidentWrite(...a),
}));

const importMembers = vi.fn();
vi.mock("@/lib/member-import", () => ({
  importMembers: (...a: unknown[]) => importMembers(...a),
  buildFieldGetter: vi.fn(() => vi.fn()),
  parseDate: vi.fn(() => new Date("2026-01-01")),
}));

const importPtaHouseholds = vi.fn();
const importHoaProperties = vi.fn();
vi.mock("@/lib/vertical-import", () => ({
  importPtaHouseholds: (...a: unknown[]) => importPtaHouseholds(...a),
  importHoaProperties: (...a: unknown[]) => importHoaProperties(...a),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { contribution: { create: vi.fn() }, orgMember: { findFirst: vi.fn() } } }));

import { POST } from "@/app/api/import/route";

function csvFormData(type: string, rows: string) {
  const form = new FormData();
  const blob = new Blob([rows], { type: "text/csv" });
  form.append("file", blob, "data.csv");
  form.append("type", type);
  form.append("mapping", "{}");
  return form;
}

function makeRequest(form: FormData) {
  return new Request("https://portal.test/api/import", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.org" } });
});

describe("POST /api/import — invalid type rejected before any guard runs", () => {
  it("400s on an unrecognized import type without calling any permission guard", async () => {
    const response = await POST(makeRequest(csvFormData("not-a-real-type", "a,b\n1,2\n")));
    expect(response.status).toBe(400);
    expect(requirePermission).not.toHaveBeenCalled();
    expect(requirePtaAccess).not.toHaveBeenCalled();
    expect(requireHoaPropertyWrite).not.toHaveBeenCalled();
  });
});

describe("POST /api/import — PTA households import is vertical-gated, not just permission-gated", () => {
  it("rejects when the organization isn't a PTA vertical (requirePtaAccess throws), never running the importer", async () => {
    requirePtaAccess.mockRejectedValueOnce(Object.assign(new Error("Not a PTA organization"), { status: 403 }));
    const response = await POST(makeRequest(csvFormData("pta-households", "householdName\nThe Smiths\n")));
    expect(response.status).toBe(500); // withApiErrorHandling's generic fallback for an unrecognized error shape
    expect(importPtaHouseholds).not.toHaveBeenCalled();
    expect(requirePermission).not.toHaveBeenCalled(); // members:write is never checked for this import type
  });

  it("proceeds when requirePtaAccess succeeds", async () => {
    requirePtaAccess.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.org" } });
    importPtaHouseholds.mockResolvedValueOnce([{ row: 2, status: "ok" }]);
    const response = await POST(makeRequest(csvFormData("pta-households", "householdName\nThe Smiths\n")));
    expect(response.status).toBe(200);
    expect(importPtaHouseholds).toHaveBeenCalledWith(expect.any(Array), {}, "org-a", "u1", "a@example.org", false);
  });
});

describe("POST /api/import — HOA properties import requires BOTH property write and resident write", () => {
  it("rejects when the organization isn't an HOA vertical (requireHoaPropertyWrite throws)", async () => {
    requireHoaPropertyWrite.mockRejectedValueOnce(Object.assign(new Error("Not an HOA organization"), { status: 403 }));
    const response = await POST(makeRequest(csvFormData("hoa-properties", "addressLine1\n142 Oak Ridge Drive\n")));
    expect(response.status).toBe(500);
    expect(importHoaProperties).not.toHaveBeenCalled();
    expect(requireHoaResidentWrite).not.toHaveBeenCalled(); // fails closed before even checking the second guard
  });

  it("rejects when property write passes but resident write does not (a role with partial HOA permissions)", async () => {
    requireHoaPropertyWrite.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.org" } });
    requireHoaResidentWrite.mockRejectedValueOnce(Object.assign(new Error("Permission denied: hoa:residents:write"), { status: 403 }));
    const response = await POST(makeRequest(csvFormData("hoa-properties", "addressLine1\n142 Oak Ridge Drive\n")));
    expect(response.status).toBe(500);
    expect(importHoaProperties).not.toHaveBeenCalled();
  });

  it("proceeds when both guards succeed", async () => {
    requireHoaPropertyWrite.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.org" } });
    requireHoaResidentWrite.mockResolvedValueOnce({ organizationId: "org-a", session: { userId: "u1", userEmail: "a@example.org" } });
    importHoaProperties.mockResolvedValueOnce([{ row: 2, status: "ok" }]);
    const response = await POST(makeRequest(csvFormData("hoa-properties", "addressLine1\n142 Oak Ridge Drive\n")));
    expect(response.status).toBe(200);
    expect(importHoaProperties).toHaveBeenCalledWith(expect.any(Array), {}, "org-a", "u1", "a@example.org", false);
  });
});

describe("POST /api/import — generic members import still uses members:write, unaffected by the new branches", () => {
  it("still routes members through requirePermission(\"members:write\")", async () => {
    importMembers.mockResolvedValueOnce([{ row: 2, status: "ok" }]);
    const response = await POST(makeRequest(csvFormData("members", "firstName,lastName\nA,B\n")));
    expect(response.status).toBe(200);
    expect(requirePermission).toHaveBeenCalledWith("members:write", "throw");
    expect(requirePtaAccess).not.toHaveBeenCalled();
    expect(requireHoaPropertyWrite).not.toHaveBeenCalled();
  });
});
