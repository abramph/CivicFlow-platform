import { requirePermission } from "@/lib/auth-guards";
import { isPtaVolunteerHoursPlatformEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac";
import { PtaError } from "../errors";
import { requirePtaHouseholdSelfAccess, requirePtaVertical } from "../guard";

/**
 * Volunteer Hour Requirements & Buyout program (docs/pta-volunteer-hours.md).
 *
 * Six independent org-level `PtaProfile` flags, all dark by default, gated
 * behind one platform-wide env kill-switch. None of these imply any of the
 * others EXCEPT that every capability below "requirements" structurally
 * needs requirement periods to exist first — so each of buyout/assessments/
 * reports/notifications additionally requires ptaVolunteerRequirementsEnabled.
 * This still satisfies the independence rules that matter: enabling reports
 * never enables payments, and enabling buyout configuration never authorizes
 * assessment posting, because each keeps its own separately-checked flag.
 */
export type VolunteerHoursCapability = "requirements" | "buyout" | "assessments" | "reports" | "notifications";

const FLAG_FIELD = {
  requirements: "ptaVolunteerRequirementsEnabled",
  buyout: "ptaVolunteerBuyoutEnabled",
  assessments: "ptaVolunteerAssessmentsEnabled",
  reports: "ptaVolunteerReportsEnabled",
  notifications: "ptaVolunteerNotificationsEnabled",
} as const;

const DISABLED_ERROR_CODE = {
  requirements: "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
  buyout: "PTA_VOLUNTEER_BUYOUT_DISABLED",
  assessments: "PTA_VOLUNTEER_ASSESSMENTS_DISABLED",
  reports: "PTA_VOLUNTEER_REPORTS_DISABLED",
  notifications: "PTA_VOLUNTEER_NOTIFICATIONS_DISABLED",
} as const;

/**
 * Throws unless the platform kill-switch is on AND (for capabilities other
 * than "requirements") both ptaVolunteerRequirementsEnabled and the specific
 * capability's own flag are true for this org. Never infers one flag's state
 * from another — every check reads the actual column.
 */
export async function requireVolunteerHoursFlag(organizationId: string, capability: VolunteerHoursCapability) {
  if (!isPtaVolunteerHoursPlatformEnabled()) {
    throw new PtaError("PTA_VOLUNTEER_HOURS_PLATFORM_DISABLED", "Volunteer hour requirements are not available on this platform.");
  }

  const profile = await prisma.ptaProfile.findUnique({
    where: { organizationId },
    select: {
      ptaVolunteerRequirementsEnabled: true,
      ptaVolunteerBuyoutEnabled: true,
      ptaVolunteerAssessmentsEnabled: true,
      ptaVolunteerReportsEnabled: true,
      ptaVolunteerNotificationsEnabled: true,
    },
  });

  if (!profile?.ptaVolunteerRequirementsEnabled) {
    throw new PtaError(
      "PTA_VOLUNTEER_REQUIREMENTS_DISABLED",
      "Volunteer hour requirements are not enabled for this organization."
    );
  }

  if (capability === "requirements") return profile;

  const flagField = FLAG_FIELD[capability];
  if (!profile[flagField]) {
    throw new PtaError(DISABLED_ERROR_CODE[capability], `This volunteer-hours capability (${capability}) is not enabled for this organization.`);
  }
  return profile;
}

/** Officer/admin-facing composed guard: RBAC permission + PTA vertical +
 * platform/org flags for the requested capability. Mirrors requirePtaAccess. */
export async function requireVolunteerHoursAccess(permission: Permission, capability: VolunteerHoursCapability) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requirePtaVertical(organizationId);
  await requireVolunteerHoursFlag(organizationId, capability);
  return { organizationId, session, role };
}

/** Family/household self-service composed guard: linkage-based access (no
 * Permission involved — mirrors requirePtaHouseholdSelfAccess) + platform/org
 * flags for the requested capability. */
export async function requireVolunteerHoursHouseholdAccess(capability: VolunteerHoursCapability) {
  const { organizationId, session, adult } = await requirePtaHouseholdSelfAccess();
  await requireVolunteerHoursFlag(organizationId, capability);
  return { organizationId, session, adult };
}

/** Non-throwing check for page rendering / conditional UI — never leaks
 * distinctions between "not a PTA org," "platform off," or "org flag off"
 * to the caller; those distinctions matter for API error codes, not for
 * deciding whether to render a nav item. */
export async function checkVolunteerHoursAvailable(organizationId: string, capability: VolunteerHoursCapability): Promise<boolean> {
  try {
    await requirePtaVertical(organizationId);
    await requireVolunteerHoursFlag(organizationId, capability);
    return true;
  } catch {
    return false;
  }
}
