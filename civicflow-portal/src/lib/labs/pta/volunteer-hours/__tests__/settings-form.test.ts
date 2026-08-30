import { describe, expect, it } from "vitest";
import { buildVolunteerHoursSaveBody } from "../settings-form";

const BASE = {
  schoolOrPtaName: "Pine Grove Elementary School PTA",
  currentSchoolYear: "2026-2027",
  canManageRequirements: false,
  canManageBuyoutPricing: false,
  canManageAssessments: false,
  canManageReportsExport: false,
  requirementsEnabled: false,
  buyoutEnabled: false,
  assessmentsEnabled: false,
  reportsEnabled: false,
  notificationsEnabled: false,
};

describe("buildVolunteerHoursSaveBody", () => {
  it("always includes the two identity fields the API requires, even with every flag permission off", () => {
    const body = buildVolunteerHoursSaveBody(BASE);
    expect(body.schoolOrPtaName).toBe("Pine Grove Elementary School PTA");
    expect(body.currentSchoolYear).toBe("2026-2027");
  });

  it("preserves whatever identity values the caller passes — this form never edits them itself", () => {
    const body = buildVolunteerHoursSaveBody({ ...BASE, schoolOrPtaName: "Riverside PTA", currentSchoolYear: "2025-2026" });
    expect(body.schoolOrPtaName).toBe("Riverside PTA");
    expect(body.currentSchoolYear).toBe("2025-2026");
  });

  it("includes ptaVolunteerRequirementsEnabled and ptaVolunteerNotificationsEnabled only when canManageRequirements is true", () => {
    const off = buildVolunteerHoursSaveBody(BASE);
    expect(off).not.toHaveProperty("ptaVolunteerRequirementsEnabled");
    expect(off).not.toHaveProperty("ptaVolunteerNotificationsEnabled");

    const on = buildVolunteerHoursSaveBody({
      ...BASE,
      canManageRequirements: true,
      requirementsEnabled: true,
      notificationsEnabled: false,
    });
    expect(on.ptaVolunteerRequirementsEnabled).toBe(true);
    expect(on.ptaVolunteerNotificationsEnabled).toBe(false);
  });

  it("includes ptaVolunteerBuyoutEnabled only when canManageBuyoutPricing is true", () => {
    const off = buildVolunteerHoursSaveBody(BASE);
    expect(off).not.toHaveProperty("ptaVolunteerBuyoutEnabled");

    const on = buildVolunteerHoursSaveBody({ ...BASE, canManageBuyoutPricing: true, buyoutEnabled: true });
    expect(on.ptaVolunteerBuyoutEnabled).toBe(true);
  });

  it("includes ptaVolunteerAssessmentsEnabled only when canManageAssessments is true", () => {
    const off = buildVolunteerHoursSaveBody(BASE);
    expect(off).not.toHaveProperty("ptaVolunteerAssessmentsEnabled");

    const on = buildVolunteerHoursSaveBody({ ...BASE, canManageAssessments: true, assessmentsEnabled: true });
    expect(on.ptaVolunteerAssessmentsEnabled).toBe(true);
  });

  it("includes ptaVolunteerReportsEnabled only when canManageReportsExport is true — the exact flag the production bug was toggling", () => {
    const off = buildVolunteerHoursSaveBody(BASE);
    expect(off).not.toHaveProperty("ptaVolunteerReportsEnabled");

    const on = buildVolunteerHoursSaveBody({ ...BASE, canManageReportsExport: true, reportsEnabled: false });
    expect(on).toHaveProperty("ptaVolunteerReportsEnabled", false);
  });

  it("represents all six flags accurately at once for a full-access caller (ORG_OWNER-shaped permission set)", () => {
    const body = buildVolunteerHoursSaveBody({
      schoolOrPtaName: "Pine Grove Elementary School PTA",
      currentSchoolYear: "2026-2027",
      canManageRequirements: true,
      canManageBuyoutPricing: true,
      canManageAssessments: true,
      canManageReportsExport: true,
      requirementsEnabled: true,
      buyoutEnabled: false,
      assessmentsEnabled: false,
      reportsEnabled: true,
      notificationsEnabled: false,
    });
    expect(body).toEqual({
      schoolOrPtaName: "Pine Grove Elementary School PTA",
      currentSchoolYear: "2026-2027",
      ptaVolunteerRequirementsEnabled: true,
      ptaVolunteerNotificationsEnabled: false,
      ptaVolunteerBuyoutEnabled: false,
      ptaVolunteerAssessmentsEnabled: false,
      ptaVolunteerReportsEnabled: true,
    });
  });

  it("a Treasurer-shaped caller (buyout-pricing manage only) never sends the reports/requirements/assessments flags", () => {
    const body = buildVolunteerHoursSaveBody({ ...BASE, canManageBuyoutPricing: true, buyoutEnabled: true });
    expect(body).toEqual({
      schoolOrPtaName: BASE.schoolOrPtaName,
      currentSchoolYear: BASE.currentSchoolYear,
      ptaVolunteerBuyoutEnabled: true,
    });
  });
});
