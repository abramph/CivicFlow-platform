import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
const requireOrganization = vi.fn();
vi.mock("@/lib/auth-guards", () => ({
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireOrganization: (...a: unknown[]) => requireOrganization(...a),
}));

const isPtaVolunteerHoursPlatformEnabled = vi.fn();
const isPtaVolunteerHoursOrgAllowed = vi.fn();
vi.mock("@/lib/env", () => ({
  isPtaVolunteerHoursPlatformEnabled: () => isPtaVolunteerHoursPlatformEnabled(),
  isPtaVolunteerHoursOrgAllowed: (...a: unknown[]) => isPtaVolunteerHoursOrgAllowed(...a),
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
  // Default to allowed so every pre-existing test in this file (written
  // before the pilot allowlist existed) keeps exercising exactly the same
  // platform/capability-flag behavior it always did. Allowlist-specific
  // tests below override this per-case.
  isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
});

// Fictional org IDs only — never a real production organization ID.
const FICTIONAL_ORG = "org-fictional-pilot-org";
const FICTIONAL_OTHER_ORG = "org-fictional-other-org";
const FICTIONAL_APPLE_REVIEWER_ORG = "org-fictional-apple-reviewer";
const FICTIONAL_GOOGLE_REVIEWER_ORG = "org-fictional-google-reviewer";

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

  it("throws PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED before ever reading PtaProfile, when the platform is on but the org isn't allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag(FICTIONAL_OTHER_ORG, "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
    expect(findUniqueProfile).not.toHaveBeenCalled();
  });

  it("the platform-disabled and not-allowlisted errors carry the identical message — a caller can't distinguish the two cases", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    const { requireVolunteerHoursFlag: flagCheck1 } = await import("../guard");
    let platformOffMessage = "";
    try {
      await flagCheck1(FICTIONAL_OTHER_ORG, "requirements");
    } catch (e) {
      platformOffMessage = (e as Error).message;
    }

    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);
    const { requireVolunteerHoursFlag: flagCheck2 } = await import("../guard");
    let notAllowlistedMessage = "";
    try {
      await flagCheck2(FICTIONAL_OTHER_ORG, "requirements");
    } catch (e) {
      notAllowlistedMessage = (e as Error).message;
    }

    expect(platformOffMessage).toBe(notAllowlistedMessage);
    expect(platformOffMessage.length).toBeGreaterThan(0);
  });

  it("stored capability flags already true for a non-allowlisted org grant nothing — the allowlist check runs before the flag is ever read", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON); // even if this were read, every flag is true
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag(FICTIONAL_OTHER_ORG, "buyout")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
    expect(findUniqueProfile).not.toHaveBeenCalled();
  });

  it("platform on, org allowlisted, capability flag also on: resolves", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON);
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag(FICTIONAL_ORG, "requirements")).resolves.toBeTruthy();
  });

  it("platform on, org allowlisted, capability flag off: denied by the capability check, not the allowlist", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue({ ...ALL_FLAGS_ON, ptaVolunteerBuyoutEnabled: false });
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag(FICTIONAL_ORG, "buyout")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_BUYOUT_DISABLED",
    });
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

describe("requireVolunteerHoursAuditAccess (FA2 §4, rule 5: audit survives any capability being disabled)", () => {
  it("resolves even when 'requirements' (the master flag) is off, unlike every other guard in this file", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
    requirePermission.mockResolvedValueOnce({ organizationId: "org-1", session: { userId: "u1" }, role: "ORG_ADMIN" });
    // Deliberately NOT mocking findUniqueProfile at all -- if this guard
    // read PtaProfile the way requireVolunteerHoursFlag does, the default
    // undefined mock would make it fail; resolving proves it never does.
    const { requireVolunteerHoursAuditAccess } = await import("../guard");
    const result = await requireVolunteerHoursAuditAccess("pta:volunteer-audit:view");
    expect(result.organizationId).toBe("org-1");
    expect(findUniqueProfile).not.toHaveBeenCalled();
  });

  it("still denies when the platform kill-switch is off", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    requirePermission.mockResolvedValueOnce({ organizationId: "org-1", session: { userId: "u1" }, role: "ORG_ADMIN" });
    const { requireVolunteerHoursAuditAccess } = await import("../guard");
    await expect(requireVolunteerHoursAuditAccess("pta:volunteer-audit:view")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED",
    });
  });

  it("still denies when the org isn't on the pilot allowlist", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);
    requirePermission.mockResolvedValueOnce({ organizationId: FICTIONAL_OTHER_ORG, session: { userId: "u1" }, role: "ORG_ADMIN" });
    const { requireVolunteerHoursAuditAccess } = await import("../guard");
    await expect(requireVolunteerHoursAuditAccess("pta:volunteer-audit:view")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
  });

  it("still denies when the org isn't PTA vertical", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
    requirePermission.mockResolvedValueOnce({ organizationId: "org-1", session: { userId: "u1" }, role: "ORG_ADMIN" });
    findUniqueOrganization.mockResolvedValueOnce({ primaryVertical: "COMMUNITY", status: "active" });
    const { requireVolunteerHoursAuditAccess } = await import("../guard");
    await expect(requireVolunteerHoursAuditAccess("pta:volunteer-audit:view")).rejects.toMatchObject({
      code: "PTA_ORGANIZATION_NOT_PTA_VERTICAL",
    });
  });

  it("still denies when the caller's RBAC permission check fails, before any PTA-specific check runs", async () => {
    requirePermission.mockRejectedValueOnce(new Error("forbidden"));
    const { requireVolunteerHoursAuditAccess } = await import("../guard");
    await expect(requireVolunteerHoursAuditAccess("pta:volunteer-audit:view")).rejects.toThrow();
    expect(findUniqueOrganization).not.toHaveBeenCalled();
  });

  it("FA3 §9: cross-org ID guessing is structurally impossible -- this function takes no organizationId argument at all; the org is exclusively whatever requirePermission resolved from the caller's OWN authenticated session, never anything a caller could pass or guess", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);

    requirePermission.mockResolvedValueOnce({ organizationId: "org-caller-a", session: { userId: "user-a" }, role: "ORG_ADMIN" });
    const { requireVolunteerHoursAuditAccess } = await import("../guard");
    const resultA = await requireVolunteerHoursAuditAccess("pta:volunteer-audit:view");
    expect(resultA.organizationId).toBe("org-caller-a");

    requirePermission.mockResolvedValueOnce({ organizationId: "org-caller-b", session: { userId: "user-b" }, role: "ORG_ADMIN" });
    const resultB = await requireVolunteerHoursAuditAccess("pta:volunteer-audit:view");
    expect(resultB.organizationId).toBe("org-caller-b"); // a different caller, in a different session, always and only gets THEIR own org back
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
  const ALL_PERMISSIONS = {
    canManageRequirements: true,
    canManageBuyoutPricing: true,
    canManageAssessments: true,
    canManageReportsExport: true,
  };

  it("is hidden when the platform switch is off, even for a role holding every manage permission and an allowlisted org", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(false, true, ALL_PERMISSIONS)).toBe(false);
  });

  it("is hidden when the org is not allowlisted, even with the platform on and every manage permission held", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(true, false, ALL_PERMISSIONS)).toBe(false);
  });

  it("is visible when the platform switch is on, the org is allowlisted, and the role holds at least one manage permission", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(true, true, HAS_ONE_PERMISSION)).toBe(true);
  });

  it("is hidden from an unauthorized role even when the platform switch is on and the org is allowlisted", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(true, true, NO_PERMISSIONS)).toBe(false);
  });

  it("stays hidden when the platform switch is off regardless of allowlist status or which single permission is held", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    expect(canViewVolunteerHoursSettingsPanel(false, true, HAS_ONE_PERMISSION)).toBe(false);
    expect(canViewVolunteerHoursSettingsPanel(false, false, HAS_ONE_PERMISSION)).toBe(false);
  });

  it("platform-off and not-allowlisted produce the identical boolean outcome — the return value alone can't reveal which case applies", async () => {
    const { canViewVolunteerHoursSettingsPanel } = await import("../guard");
    const platformOff = canViewVolunteerHoursSettingsPanel(false, true, ALL_PERMISSIONS);
    const notAllowlisted = canViewVolunteerHoursSettingsPanel(true, false, ALL_PERMISSIONS);
    expect(platformOff).toBe(notAllowlisted);
  });
});

describe("pilot allowlist — tenant isolation", () => {
  it("an allowlisted organization cannot resolve access for a different, non-allowlisted organization's ID", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockImplementation((orgId: string) => orgId === FICTIONAL_ORG);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON);
    const { requireVolunteerHoursFlag } = await import("../guard");

    await expect(requireVolunteerHoursFlag(FICTIONAL_ORG, "requirements")).resolves.toBeTruthy();
    await expect(requireVolunteerHoursFlag(FICTIONAL_OTHER_ORG, "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
  });

  it("a non-allowlisted organization's own database flags being true never leaks access to the allowlisted organization's data — each call is checked independently by its own organizationId argument", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockImplementation((orgId: string) => orgId === FICTIONAL_ORG);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON);
    const { requireVolunteerHoursFlag } = await import("../guard");

    await expect(requireVolunteerHoursFlag(FICTIONAL_OTHER_ORG, "reports")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
    // The allowlisted org is unaffected by the other org's denied call.
    await expect(requireVolunteerHoursFlag(FICTIONAL_ORG, "reports")).resolves.toBeTruthy();
  });
});

describe("pilot allowlist — reviewer protection (fictional IDs only, never real production IDs)", () => {
  it("an Apple-reviewer-shaped organization with every capability flag accidentally true is still denied when not allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockImplementation((orgId: string) => orgId === FICTIONAL_ORG);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON); // flags accidentally all true
    const { requireVolunteerHoursFlag } = await import("../guard");

    await expect(requireVolunteerHoursFlag(FICTIONAL_APPLE_REVIEWER_ORG, "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
    expect(findUniqueProfile).not.toHaveBeenCalled();
  });

  it("a Google-reviewer-shaped organization with every capability flag accidentally true is still denied when not allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockImplementation((orgId: string) => orgId === FICTIONAL_ORG);
    findUniqueProfile.mockResolvedValue(ALL_FLAGS_ON);
    const { requireVolunteerHoursFlag } = await import("../guard");

    await expect(requireVolunteerHoursFlag(FICTIONAL_GOOGLE_REVIEWER_ORG, "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
    expect(findUniqueProfile).not.toHaveBeenCalled();
  });

  it("billing-exempt status is irrelevant to the allowlist check — the guard never reads or considers it", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockImplementation((orgId: string) => orgId === FICTIONAL_ORG);
    const { requireVolunteerHoursFlag } = await import("../guard");
    // A billing-exempt-shaped org is still just an ordinary organizationId
    // to this guard — no billingExempt field is ever read or passed in.
    await expect(requireVolunteerHoursFlag("org-fictional-billing-exempt", "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
  });

  it("an organization named 'Demo' receives no special treatment — only the allowlisted organizationId matters, never a name", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockImplementation((orgId: string) => orgId === FICTIONAL_ORG);
    const { requireVolunteerHoursFlag } = await import("../guard");
    // requireVolunteerHoursFlag never takes or looks up an org name — it
    // only ever sees organizationId, so a "Demo"-named org gets exactly the
    // same treatment as any other non-allowlisted ID.
    await expect(requireVolunteerHoursFlag("org-fictional-demo-named", "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
  });

  it("Pine-Grove-shaped organization: no access when the platform switch is OFF, even if allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(false);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag(FICTIONAL_ORG, "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED",
    });
  });

  it("Pine-Grove-shaped organization: no access when absent from the allowlist, even with the platform switch ON", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(false);
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag(FICTIONAL_ORG, "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_HOURS_ORG_NOT_ALLOWLISTED",
    });
  });

  it("Pine-Grove-shaped organization: no capability access until its own requirements flag is also enabled, even once platform-on and allowlisted", async () => {
    isPtaVolunteerHoursPlatformEnabled.mockReturnValue(true);
    isPtaVolunteerHoursOrgAllowed.mockReturnValue(true);
    findUniqueProfile.mockResolvedValue({ ...ALL_FLAGS_ON, ptaVolunteerRequirementsEnabled: false });
    const { requireVolunteerHoursFlag } = await import("../guard");
    await expect(requireVolunteerHoursFlag(FICTIONAL_ORG, "requirements")).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
    });
  });
});
