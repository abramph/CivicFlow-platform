import type { OrganizationVertical } from "@prisma/client";

/**
 * Central capability-flag resolver (PR #43). Every vertical-specific
 * feature area gets one boolean flag here rather than scattering raw
 * `organization.primaryVertical === "HOA"` checks through pages/routes —
 * see docs/hoa-domain-model.md and the PR #43 spec's explicit instruction
 * to centralize this. Only "properties"/"propertyResidents" are actually
 * activated in this PR (HOA foundation only); the remaining keys are
 * declared now so future PRs (Violation/ArchitecturalRequest/
 * MaintenanceRequest per docs/hoa-mvp-recommendation.md) extend this same
 * map instead of inventing a parallel mechanism.
 */
export type CapabilityFlag =
  | "properties"
  | "propertyResidents"
  | "violations"
  | "architecturalRequests"
  | "maintenanceRequests"
  | "payrollCheckoff"
  | "ptaHouseholds"
  | "caseManagement";

const ALL_FLAGS: CapabilityFlag[] = [
  "properties",
  "propertyResidents",
  "violations",
  "architecturalRequests",
  "maintenanceRequests",
  "payrollCheckoff",
  "ptaHouseholds",
  "caseManagement",
];

/** Which flags are on for each vertical. Absent keys default to false. */
const VERTICAL_CAPABILITIES: Record<OrganizationVertical, Partial<Record<CapabilityFlag, true>>> = {
  COMMUNITY: {},
  PTA: {
    ptaHouseholds: true,
  },
  UNION: {
    payrollCheckoff: true,
    // Union Case Center (UNION-CASE-A) -- grievance & representation case
    // management. See src/lib/union/cases-guard.ts.
    caseManagement: true,
  },
  HOA: {
    properties: true,
    propertyResidents: true,
    // Violations MVP -- see docs/hoa-violations-mvp.md.
    violations: true,
    // Architectural Requests -- see docs/hoa-domain-model.md's original
    // planning table and this PR's own docs/hoa-architectural-requests.md.
    architecturalRequests: true,
    // maintenanceRequests intentionally NOT enabled yet -- that model
    // doesn't exist until a later PR (this task's explicit instruction not
    // to begin it yet). Flipping it on without the underlying model/routes
    // would advertise a capability that doesn't work.
  },
  // CHURCH-VERT-A: no vertical-level capability flags -- giving is already
  // gated by real data (whether the org has Funds/ContributionPrograms
  // configured, see mobile getGiving()'s enabled boolean), not a capability
  // flag, exactly like COMMUNITY. Adding a flag here would just duplicate
  // that existing data-driven gate.
  CHURCH: {},
};

/** Always returns every known flag, explicit `false` for anything not
 * enabled for this vertical -- callers never need an `?? false` fallback. */
export function getVerticalCapabilities(vertical: OrganizationVertical): Record<CapabilityFlag, boolean> {
  const enabled = VERTICAL_CAPABILITIES[vertical] ?? {};
  return Object.fromEntries(ALL_FLAGS.map((flag) => [flag, enabled[flag] === true])) as Record<CapabilityFlag, boolean>;
}

export function hasVerticalCapability(vertical: OrganizationVertical, flag: CapabilityFlag): boolean {
  return getVerticalCapabilities(vertical)[flag];
}
