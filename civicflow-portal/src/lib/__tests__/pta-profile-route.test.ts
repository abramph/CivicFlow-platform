import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePtaAccess = vi.fn();
vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaAccess: (...a: unknown[]) => requirePtaAccess(...a),
}));

const isPtaVolunteerHoursPlatformEnabled = vi.fn();
const isPtaVolunteerHoursOrgAllowed = vi.fn();
vi.mock("@/lib/env", () => ({
  isPtaVolunteerHoursPlatformEnabled: () => isPtaVolunteerHoursPlatformEnabled(),
  isPtaVolunteerHoursOrgAllowed: (...a: unknown[]) => isPtaVolunteerHoursOrgAllowed(...a),
}));

const getPtaProfile = vi.fn();
const upsertPtaProfile = vi.fn();
vi.mock("@/lib/labs/pta/profile", () => ({
  getPtaProfile: (...a: unknown[]) => getPtaProfile(...a),
  upsertPtaProfile: (...a: unknown[]) => upsertPtaProfile(...a),
}));

import { GET, PUT } from "@/app/api/labs/pta/profile/route";

function putRequest(body: unknown) {
  return new Request("https://portal.test/api/labs/pta/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = { schoolOrPtaName: "Riverside PTA", currentSchoolYear: "2026-2027" };

describe("PUT /api/labs/pta/profile — volunteer-hours platform kill-switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePtaAccess.mockResolvedValue({ organizationId: "org-1", session: { userId: "u1", userEmail: "officer@example.com" } });
    upsertPtaProfile.mockResolvedValue({ id: "profile-1" });
    // Default to allowlisted so every pre-existing test in this file (written
    // before the pilot allowlist existed) keeps exercising exactly the
    // platform-switch behavior it always did. Allowlist-specific tests below
    // override this per-case.
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
  });

  it("rejects a write to a volunteer-hours flag when the platform switch is off — direct API call fails closed", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);

    const response = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(upsertPtaProfile).not.toHaveBeenCalled();
  });

  it.each([
    "ptaVolunteerRequirementsEnabled",
    "ptaVolunteerBuyoutEnabled",
    "ptaVolunteerAssessmentsEnabled",
    "ptaVolunteerReportsEnabled",
    "ptaVolunteerNotificationsEnabled",
    "ptaVolunteerNativeMobileEnabled",
  ])("rejects a write to %s specifically when the platform switch is off, even set to false", async (field) => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);

    const response = await PUT(putRequest({ ...BASE_BODY, [field]: false }));

    expect(response.status).toBe(403);
    expect(upsertPtaProfile).not.toHaveBeenCalled();
  });

  it("accepts a permitted volunteer-hours flag write once the platform switch is on", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);

    const response = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(upsertPtaProfile).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", ptaVolunteerRequirementsEnabled: true })
    );
  });

  it("does not block ordinary profile edits that touch none of the six flags, even while the platform switch is off", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);

    const response = await PUT(putRequest(BASE_BODY));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(upsertPtaProfile).toHaveBeenCalled();
  });

  it("still requires the underlying RBAC permission regardless of the platform switch — an unauthorized role is denied before the platform check even matters", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    requirePtaAccess.mockRejectedValueOnce(new Error("forbidden"));

    const response = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));
    expect(response.status).not.toBe(200);
    expect(upsertPtaProfile).not.toHaveBeenCalled();
  });

  it("treats two different organizations identically — no organization-specific bypass exists, reviewer organizations included", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);

    requirePtaAccess.mockResolvedValueOnce({ organizationId: "org-ordinary", session: { userId: "u1", userEmail: "a@example.com" } });
    const first = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));

    requirePtaAccess.mockResolvedValueOnce({ organizationId: "org-apple-reviewer-demo", session: { userId: "u2", userEmail: "b@example.com" } });
    const second = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));

    expect(first.status).toBe(403);
    expect(second.status).toBe(403);
    expect(upsertPtaProfile).not.toHaveBeenCalled();
  });

  it("rejects a volunteer-hours flag write when the platform is on but the organization isn't allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);

    const response = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(upsertPtaProfile).not.toHaveBeenCalled();
  });

  it("accepts a permitted volunteer-hours flag write once the platform is on AND the organization is allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);

    const response = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("does not block ordinary profile edits that touch none of the six flags, even when the organization isn't allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);

    const response = await PUT(putRequest(BASE_BODY));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it("the platform-off response and the not-allowlisted response are indistinguishable — never reveals whether another organization is allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    const platformOffResponse = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));
    const platformOffData = await platformOffResponse.json();

    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);
    const notAllowlistedResponse = await PUT(putRequest({ ...BASE_BODY, ptaVolunteerRequirementsEnabled: true }));
    const notAllowlistedData = await notAllowlistedResponse.json();

    expect(platformOffResponse.status).toBe(notAllowlistedResponse.status);
    expect(platformOffData.error).toBe(notAllowlistedData.error);
  });
});

describe("GET /api/labs/pta/profile — unaffected by the platform switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePtaAccess.mockResolvedValue({ organizationId: "org-1", session: { userId: "u1", userEmail: "officer@example.com" } });
    getPtaProfile.mockResolvedValue({ id: "profile-1", ptaVolunteerRequirementsEnabled: false });
  });

  it("still returns the stored profile when the platform switch is off — reading isn't gated, only writing the six flags is", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(getPtaProfile).toHaveBeenCalledWith("org-1");
  });
});
