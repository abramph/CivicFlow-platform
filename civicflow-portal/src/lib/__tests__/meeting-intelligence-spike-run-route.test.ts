import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: (...args: unknown[]) => requirePermission(...args),
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

const recordMeetingIntelligenceUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/meeting-intelligence/usage", () => ({
  recordMeetingIntelligenceUsage: (...args: unknown[]) => recordMeetingIntelligenceUsage(...args),
}));

import { POST } from "@/app/api/labs/meeting-intelligence-spike/run/route";

describe("POST /api/labs/meeting-intelligence-spike/run", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    requirePermission.mockResolvedValue({ organizationId: "aph-org" });
    requireOrganizationLabFeature.mockReset();
    recordMeetingIntelligenceUsage.mockClear();
  });

  it("requires labs:read permission before doing anything else", async () => {
    await POST();
    expect(requirePermission).toHaveBeenCalledWith("labs:read", "throw");
  });

  it("gates on requireOrganizationLabFeature(organizationId, 'meetingIntelligence')", async () => {
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    await POST();
    expect(requireOrganizationLabFeature).toHaveBeenCalledWith("aph-org", "meetingIntelligence");
  });

  it("returns a standardized 403 Labs denial and records no usage when the organization lacks access", async () => {
    const { LabFeatureError } = await import("@/lib/labs/access");
    requireOrganizationLabFeature.mockRejectedValueOnce(
      new LabFeatureError("LAB_FEATURE_NOT_ENROLLED", "meetingIntelligence", "This organization is not enrolled in this Labs feature.")
    );
    const response = await POST();
    const payload = await response.json();
    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ ok: false, code: "LAB_FEATURE_NOT_ENROLLED", feature: "meetingIntelligence" });
    expect(recordMeetingIntelligenceUsage).not.toHaveBeenCalled();
  });

  it("runs the pipeline, records usage, and returns draft-status minutes when access is granted", async () => {
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.data.draftMinutes.status).toBe("draft");
    expect(recordMeetingIntelligenceUsage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "aph-org", providerId: payload.data.providerId })
    );
  });

  it("scopes every run to exactly the caller's own organizationId — never a client-supplied value", async () => {
    requireOrganizationLabFeature.mockResolvedValueOnce(undefined);
    requirePermission.mockResolvedValueOnce({ organizationId: "different-org" });
    await POST();
    expect(requireOrganizationLabFeature).toHaveBeenCalledWith("different-org", "meetingIntelligence");
  });
});
