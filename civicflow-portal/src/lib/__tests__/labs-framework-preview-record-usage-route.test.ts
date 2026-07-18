import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({ organizationId: "org-a" }),
  };
});

const requireOrganizationLabFeature = vi.fn();
vi.mock("@/lib/labs/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/labs/access")>();
  return {
    ...actual,
    requireOrganizationLabFeature: (...args: unknown[]) => requireOrganizationLabFeature(...args),
  };
});

const recordLabUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/usage", () => ({
  recordLabUsage: (...args: unknown[]) => recordLabUsage(...args),
}));

import { POST } from "@/app/api/labs/framework-preview/record-usage/route";

describe("POST /api/labs/framework-preview/record-usage", () => {
  beforeEach(() => {
    requireOrganizationLabFeature.mockReset();
    recordLabUsage.mockClear();
  });

  it("records a trivial, contentless usage event when the organization has access", async () => {
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(recordLabUsage).toHaveBeenCalledWith({
      organizationId: "org-a",
      featureKey: "labsFrameworkPreview",
      unit: "automation_executions",
      quantity: 1,
      metadata: { action: "preview_panel_viewed" },
    });
  });

  it("returns a standardized Labs denial and never records usage when the organization lacks access", async () => {
    const { LabFeatureError } = await import("@/lib/labs/access");
    requireOrganizationLabFeature.mockRejectedValueOnce(
      new LabFeatureError("LAB_FEATURE_INTERNAL_ONLY", "labsFrameworkPreview", "This Labs feature is internal-only.")
    );
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ ok: false, code: "LAB_FEATURE_INTERNAL_ONLY", feature: "labsFrameworkPreview" });
    expect(recordLabUsage).not.toHaveBeenCalled();
  });
});
