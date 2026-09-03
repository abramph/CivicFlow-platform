import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePtaAccess = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({ requirePtaAccess: (...a: unknown[]) => requirePtaAccess(...a) }));

const upsertPtaProfile = vi.fn();
const getPtaProfile = vi.fn();
vi.mock("@/lib/labs/pta/profile", () => ({
  upsertPtaProfile: (...a: unknown[]) => upsertPtaProfile(...a),
  getPtaProfile: (...a: unknown[]) => getPtaProfile(...a),
}));

vi.mock("@/lib/labs/pta/volunteer-hours/flags", () => ({
  VOLUNTEER_HOURS_FLAG_KEYS: [
    "ptaVolunteerRequirementsEnabled",
    "ptaVolunteerBuyoutEnabled",
    "ptaVolunteerAssessmentsEnabled",
    "ptaVolunteerReportsEnabled",
    "ptaVolunteerNotificationsEnabled",
    "ptaVolunteerNativeMobileEnabled",
  ],
  updatePtaVolunteerHoursFlags: vi.fn(),
}));

const isPtaStudentProgressionPlatformEnabled = vi.fn();
vi.mock("@/lib/env", () => ({
  isPtaVolunteerHoursPlatformEnabled: vi.fn().mockReturnValue(true),
  isPtaVolunteerHoursOrgAllowed: vi.fn().mockReturnValue(true),
  isPtaStudentProgressionPlatformEnabled: (...a: unknown[]) => isPtaStudentProgressionPlatformEnabled(...a),
}));

function jsonRequest(body: unknown) {
  return new Request("https://portal.test/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const BASE_BODY = { schoolOrPtaName: "Test PTA", currentSchoolYear: "2027-2028" };

beforeEach(() => {
  vi.clearAllMocks();
  isPtaStudentProgressionPlatformEnabled.mockReturnValue(true);
  requirePtaAccess.mockResolvedValue({ organizationId: "org-1", session: { userId: "u1", userEmail: "officer@example.org" } });
  upsertPtaProfile.mockResolvedValue({});
  getPtaProfile.mockResolvedValue({});
});

describe("PUT /api/labs/pta/profile -- studentProgressionEnabled gating", () => {
  it("does not require the commit-tier permission when the flag isn't touched", async () => {
    const { PUT } = await import("../route");
    await PUT(jsonRequest(BASE_BODY));
    expect(requirePtaAccess).not.toHaveBeenCalledWith("pta:student-progression:commit");
  });

  it("requires the commit-tier permission (not the ordinary profile-edit permission alone) when the flag IS touched", async () => {
    const { PUT } = await import("../route");
    await PUT(jsonRequest({ ...BASE_BODY, studentProgressionEnabled: true }));
    expect(requirePtaAccess).toHaveBeenCalledWith("pta:student-progression:commit");
  });

  it("fails closed when the platform kill-switch is off, even for a caller who otherwise holds the commit permission", async () => {
    isPtaStudentProgressionPlatformEnabled.mockReturnValue(false);
    const { PUT } = await import("../route");
    const res = await PUT(jsonRequest({ ...BASE_BODY, studentProgressionEnabled: true }));
    expect(res.status).not.toBe(200);
    expect(upsertPtaProfile).not.toHaveBeenCalled();
  });

  it("propagates a permission rejection without ever writing the profile", async () => {
    requirePtaAccess.mockImplementation(async (permission: string) => {
      if (permission === "pta:student-progression:commit") {
        const { PtaError } = await import("@/lib/labs/pta/errors");
        throw new PtaError("PTA_VALIDATION_ERROR", "forbidden");
      }
      return { organizationId: "org-1", session: { userId: "u1", userEmail: "officer@example.org" } };
    });
    const { PUT } = await import("../route");
    const res = await PUT(jsonRequest({ ...BASE_BODY, studentProgressionEnabled: true }));
    expect(res.status).not.toBe(200);
    expect(upsertPtaProfile).not.toHaveBeenCalled();
  });
});
