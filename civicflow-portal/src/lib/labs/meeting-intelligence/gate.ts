import "server-only";
import { requirePermission } from "@/lib/auth-guards";
import { getOrganizationLabAccess, type LabAccessResult } from "@/lib/labs/access";

/**
 * Shared server-side gate for every Meeting Intelligence Spike page —
 * resolves the acting user's tenant permission (labs:read) and the
 * organization's Labs access (meetingIntelligence: internal-only,
 * requires explicit enrollment) once, so every page renders the same
 * "not available" experience instead of each re-deriving the check.
 */
export async function getMeetingIntelligenceSpikeGate(): Promise<{ organizationId: string; access: LabAccessResult }> {
  const { organizationId } = await requirePermission("labs:read");
  const access = await getOrganizationLabAccess(organizationId, "meetingIntelligence");
  return { organizationId, access };
}
