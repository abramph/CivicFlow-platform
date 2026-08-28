import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
const requireOrganization = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireOrganization: (...a: unknown[]) => requireOrganization(...a),
}));

const isPtaVolunteerHoursPlatformEnabled = vi.fn();
vi.mock("@/lib/env", () => ({
  isPtaVolunteerHoursPlatformEnabled: () => isPtaVolunteerHoursPlatformEnabled(),
}));

const findUniqueOrganization = vi.fn();
const findUniqueProfile = vi.fn();
const findFirstAdult = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findUniqueOrganization(...a) },
    ptaProfile: { findUnique: (...a: unknown[]) => findUniqueProfile(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a) },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrganization.mockResolvedValue({ primaryVertical: "PTA", status: "active" });
});

const ALL_FLAGS_ON = {
  ptaVolunteerRequirementsEnabled: true,
  ptaVolunteerBuyoutEnabled: true,
  ptaVolunteerAssessmentsEnabled: true,
  ptaVolunteerReportsEnabled: true,
  ptaVolunteerNotificationsEnabled: true,
};

describe("requireVolunteerHoursFlag", () => {
  it("throws PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED before ever reading PtaProfile, when the platform kill-switch is off", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag("org-1", "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED",
    });
    expect(findUniqueProfile).not.toHaveBeenCalled();
  });

  it("throws PTA_VOLUNTEER_REQUIREMENTS_DISABLED when the org's master flag is off, even for capability=requirements", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue({ ...ALL_FLAGS_ON, ptaVolunteerRequirementsEnabled: false });
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag("org-1", "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
    });
  });

  it("throws PTA_VOLUNTEER_REQUIREMENTS_DISABLED for a downstream capability when the master flag is off, even if that capability's own flag is on", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue({ ...ALL_FLAGS_ON, ptaVolunteerRequirementsEnabled: false });
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag("org-1", "buyout")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
    });
  });

  it("throws PTA_PROFILE-shaped requirements-disabled error when no PtaProfile row exists at all", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue(null);
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag("org-1", "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
    });
  });

  it.each([
    ["buyout", "PTA_VOLUNTEER_BUYOUT_DISABLED", "ptaVolunteerBuyoutEnabled"],
    ["assessments", "PTA_VOLUNTEER_ASSESSMENTS_DISABLED", "ptaVolunteerAssessmentsEnabled"],
    ["reports", "PTA_VOLUNTEER_REPORTS_DISABLED", "ptaVolunteerReportsEnabled"],
    ["notifications", "PTA_VOLUNTEER_NOTIFICATIONS_DISABLED", "ptaVolunteerNotificationsEnabled"],
  ] as const)(
    "requirements on but %s's own flag off throws %s — never inferred from another flag being on",
    async (capability, expectedCode, ownField) => {
      isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
      findUniqueProfile.mockResolvedValue({ ...ALL_FLAGS_ON, [ownField]: false });
      const { requireVolunteerHoursFlag } = await import("../guard");
      await expect(requireVolunteerHoursFlag("org-1", capability)).rejects.toMatchObject({ code: expectedCode });
    }
  );

  it("enabling buyout does not implicitly enable assessments (independence check)", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue({
      ...ALL_FLAGS_ON,
      ptaVolunteerBuyoutEnabled: true,
      ptaVolunteerAssessmentsEnabled: false,
    });
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag("org-1", "buyout")).resolves.toBeTruthy();
    await expect(requireVolunteerHoursFlag("org-1", "assessments")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_ASSESSMENTS_DISABLED",
    });
  });

  it("enabling reports does not implicitly enable buyout (independence check)", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue({
      ...ALL_FLAGS_ON,
      ptaVolunteerReportsEnabled: true,
      ptaVolunteerBuyoutEnabled: false,
    });
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag("org-1", "reports")).resolves.toBeTruthy();
    await expect(requireVolunteerHoursFlag("org-1", "buyout")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_BUYOUT_DISABLED",
    });
  });

  it("resolves when every relevant flag is on", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON);
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag("org-1", "buyout")).resolves.toBeTruthy();
  });
});

describe("requireVolunteerHoursAccess", () => {
  it("checks RBAC permission, PTA vertical, and the flag, in that order", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON);
    requirePermission.mockResolvedValueOnce({ organizationId: "org-1", session: { userId: "u1" }, role: "ORG_ADMIN" });

    const { requireVolunteerHoursAccess } = await import("../guard");
    const result = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    expect(result.organizationId).toBe("org-1");
    expect(requirePermission).toHaveBeenCalledWith("pta:volunteer-requirements:view", "throw");
  });

  it("still denies when RBAC passes but the org isn't PTA vertical", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-1", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });

    const { requireVolunteerHoursAccess } = await import("../guard");
    await expect(requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements")).rejects.toMatchObject({
      code: "PTA_ORGANIZATION_NOT_PTA_VERTICAL",
    });
  });
});

describe("checkVolunteerHoursAvailable", () => {
  it("returns false rather than throwing when the flag is off", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    const { checkVolunteerHoursAvailable } = await import("../guard");
    await expect(checkVolunteerHoursAvailable("org-1", "requirements")).resolves.toBe(false);
  });

  it("returns true when everything is enabled", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON);
    const { checkVolunteerHoursAvailable } = await import("../guard");
    await expect(checkVolunteerHoursAvailable("org-1", "requirements")).resolves.toBe(true);
  });

  it("behaves identically for an ordinary org and an Apple/Google reviewer demo org — no organization-specific bypass", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    const { checkVolunteerHoursAvailable } = await import("../guard");
    const ordinary = await checkVolunteerHoursAvailable("org-ordinary", "requirements");
    const reviewer = await checkVolunteerHoursAvailable("org-apple-reviewer-demo", "requirements");
    expect(ordinary).toBe(false);
    expect(reviewer).toBe(false);
  });
});

describe("canViewVolunteerHoursSettingsPanel", () => {
  const NO_PERMISSIONS = {
    canManageRequirements: false,
    canManageBuyoutPricing: false,
    canManageAssessments: false,
    canManageReportsExport: false,
  };
  const HAS_ONE_PERMISSION = { ...NO_PERMISSIONS, canManageRequirements: true };

  it("is hidden when the platform switch is off, even for a role holding every manage permission", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    const allPermissions = {
      canManageRequirements: true,
      canManageBuyoutPricing: true,
      canManageAssessments: true,
      canManageReportsExport: true,
    };
    expect(canViewVolunteerHoursSettingsPanel(false, allPermissions)).toBe(false);
  });

  it("is visible when the platform switch is on and the role holds at least one manage permission", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(true, HAS_ONE_PERMISSION)).toBe(true);
  });

  it("is hidden from an unauthorized role even when the platform switch is on", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(true, NO_PERMISSIONS)).toBe(false);
  });

  it("stays hidden when the platform switch is off regardless of which single permission is held", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(false, HAS_ONE_PERMISSION)).toBe(false);
  });
});
