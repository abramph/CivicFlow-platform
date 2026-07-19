import "server-only";
import { requirePermission } from "@/lib/auth-guards";
import { getOrganizationLabAccess, type LabAccessResult } from "@/lib/labs/access";
import type { Permission } from "@/lib/rbac";

/** Server-component gate mirroring guard.ts's API-route composition, for pages. */
export async function getMeetingIntelligencePageGate(permission: Permission): Promise<{
  organizationId: string;
  userId: string;
  userEmail: string;
  can: (permission: Permission) => boolean;
  access: LabAccessResult;
}> {
  const { organizationId, session, can } = await requirePermission(permission);
  const access = await getOrganizationLabAccess(organizationId, "meetingIntelligence");
  return { organizationId, userId: session.userId, userEmail: session.userEmail, can, access };
}
