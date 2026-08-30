/**
 * Pure request-body builder for PtaVolunteerHoursSettings.tsx's save button,
 * kept in a plain .ts module (not inline in the component) specifically so
 * it's unit-testable — this repo's Vitest setup is Node-only (no jsdom/React
 * Testing Library, see vitest.config.ts and
 * components/labs/pta/__tests__/refresh-consistency.test.ts's note), so a
 * .tsx client component's own logic can't be exercised by mounting it.
 *
 * fix/pta-volunteer-settings-atomic-audit: this is the exact fix for the
 * production bug where the settings page's save request omitted
 * schoolOrPtaName/currentSchoolYear, which PUT /api/labs/pta/profile
 * requires on every request — every 400 the officer saw. The identity
 * fields are always included here, sourced from the caller's current
 * profile values, never from a field this form lets the user edit.
 */
export interface BuildVolunteerHoursSaveBodyInput {
  schoolOrPtaName: string;
  currentSchoolYear: string;
  canManageRequirements: boolean;
  canManageBuyoutPricing: boolean;
  canManageAssessments: boolean;
  canManageReportsExport: boolean;
  requirementsEnabled: boolean;
  buyoutEnabled: boolean;
  assessmentsEnabled: boolean;
  reportsEnabled: boolean;
  notificationsEnabled: boolean;
}

export function buildVolunteerHoursSaveBody(input: BuildVolunteerHoursSaveBodyInput) {
  return {
    schoolOrPtaName: input.schoolOrPtaName,
    currentSchoolYear: input.currentSchoolYear,
    ...(input.canManageRequirements
      ? { ptaVolunteerRequirementsEnabled: input.requirementsEnabled, ptaVolunteerNotificationsEnabled: input.notificationsEnabled }
      : {}),
    ...(input.canManageBuyoutPricing ? { ptaVolunteerBuyoutEnabled: input.buyoutEnabled } : {}),
    ...(input.canManageAssessments ? { ptaVolunteerAssessmentsEnabled: input.assessmentsEnabled } : {}),
    ...(input.canManageReportsExport ? { ptaVolunteerReportsEnabled: input.reportsEnabled } : {}),
  };
}
