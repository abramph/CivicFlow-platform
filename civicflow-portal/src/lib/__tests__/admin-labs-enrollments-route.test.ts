import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args),
  };
});

const setOrganizationLabEnrollment = vi.fn();
vi.mock("@/lib/platform-operations/labs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-operations/labs")>();
  return {
    ...actual,
    setOrganizationLabEnrollment: (...args: unknown[]) => setOrganizationLabEnrollment(...args),
  };
});

import { PUT } from "@/app/api/admin/labs/enrollments/route";
import { ForbiddenError } from "@/lib/auth-guards";
import { LabEnrollmentValidationError } from "@/lib/platform-operations/labs";

function putRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/admin/labs/enrollments", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/admin/labs/enrollments", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session: { userId: "admin-1", userEmail: "admin@example.com" } });
    setOrganizationLabEnrollment.mockReset();
  });

  it("rejects an unauthorized (non-platform-access) caller with 403 rather than performing the write", async () => {
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Platform role denied: SUPER_ADMIN"));
    const response = await PUT(putRequest({ organizationId: "org-a", featureKey: "labsFrameworkPreview", status: "ENABLED", confirm: true }));
    expect(response.status).toBe(403);
    expect(setOrganizationLabEnrollment).not.toHaveBeenCalled();
  });

  it("requires the explicit confirm:true flag — rejects a request without it", async () => {
    const response = await PUT(putRequest({ organizationId: "org-a", featureKey: "labsFrameworkPreview", status: "ENABLED" }));
    expect(response.status).toBe(400);
    expect(setOrganizationLabEnrollment).not.toHaveBeenCalled();
  });

  it("rejects an unknown feature key with a 400, not a 500", async () => {
    const response = await PUT(putRequest({ organizationId: "org-a", featureKey: "notARealFeature", status: "ENABLED", confirm: true }));
    expect(response.status).toBe(400);
    expect(setOrganizationLabEnrollment).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value with a 400", async () => {
    const response = await PUT(putRequest({ organizationId: "org-a", featureKey: "labsFrameworkPreview", status: "MADE_UP_STATUS", confirm: true }));
    expect(response.status).toBe(400);
    expect(setOrganizationLabEnrollment).not.toHaveBeenCalled();
  });

  it("converts LabEnrollmentValidationError (e.g. invalid organization) into a 400, not a 500", async () => {
    setOrganizationLabEnrollment.mockRejectedValueOnce(new LabEnrollmentValidationError("Organization not found: org-x"));
    const response = await PUT(putRequest({ organizationId: "org-x", featureKey: "labsFrameworkPreview", status: "ENABLED", confirm: true }));
    expect(response.status).toBe(400);
  });

  it("performs the write and returns 200 for an authorized, valid, confirmed request", async () => {
    setOrganizationLabEnrollment.mockResolvedValueOnce({
      id: "enr-1",
      organizationId: "aph-org",
      organizationName: "APH Technologies, LLC",
      organizationSlug: "aph-technologies",
      featureKey: "labsFrameworkPreview",
      status: "ENABLED",
      enabledAt: new Date().toISOString(),
      disabledAt: null,
      enrollmentSource: "operations_center",
      notes: null,
      updatedAt: new Date().toISOString(),
    });

    const response = await PUT(putRequest({ organizationId: "aph-org", featureKey: "labsFrameworkPreview", status: "ENABLED", confirm: true }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(setOrganizationLabEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "aph-org", featureKey: "labsFrameworkPreview", status: "ENABLED", actorUserId: "admin-1" })
    );
  });
});
