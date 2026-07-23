import { requireOrganization, requirePermission } from "@/lib/auth-guards";
import { getOrganizationLabAccess, requireOrganizationLabFeature } from "@/lib/labs/access";
import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/rbac";
import { PtaError } from "./errors";

/**
 * The composed guard every officer-facing PTA route/page must call first:
 * tenant RBAC permission (organization-scoped, session-resolved) AND Labs
 * organization access (entitlement + enrollment + internal-only ceiling).
 * Mirrors meeting-intelligence/guard.ts's requireMeetingIntelligenceAccess().
 */
export async function requirePtaAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requireOrganizationLabFeature(organizationId, "ptaVertical");
  return { organizationId, session, role };
}

/** Page-component variant (redirect mode, matches meeting-intelligence/page-gate.ts's convention) — pages should redirect on denial, not throw an unhandled error. */
export async function getPtaPageGate(permission: Permission) {
  const { organizationId, session, role, can } = await requirePermission(permission);
  const access = await getOrganizationLabAccess(organizationId, "ptaVertical");
  return { organizationId, session, role, can, access };
}

/**
 * Parent/household-adult self-service guard — deliberately NOT built on
 * requirePermission()/canDo() (a MEMBER-role user always holds zero
 * permissions — see rbac.ts). Authorization here comes from the caller
 * actually being a linked PtaHouseholdAdult in the active organization, not
 * from any role/permission grant. Mirrors the existing mobile-portal
 * convention of scoping strictly to the caller's own linked record.
 *
 * Requires the linked household's status to be ACTIVE — caught during the
 * post-implementation hardening review: without this check, a parent whose
 * household had been deactivated (e.g. left the PTA, membership lapsed)
 * could still claim volunteer slots, RSVP, and view household data through
 * every self-service route, since none of those routes re-checked household
 * status themselves. Centralizing the check here (rather than in every
 * caller) is what makes it actually enforced everywhere at once.
 */
export async function requirePtaHouseholdSelfAccess() {
  const { organizationId, session } = await requireOrganization();
  await requireOrganizationLabFeature(organizationId, "ptaVertical");

  const adult = await prisma.ptaHouseholdAdult.findFirst({
    where: { organizationId, userId: session.userId },
    include: { household: { select: { id: true, status: true } } },
  });
  if (!adult) {
    throw new PtaError("PTA_NOT_A_HOUSEHOLD_MEMBER", "Your account is not linked to a PTA household in this organization.");
  }
  if (adult.household.status !== "ACTIVE") {
    throw new PtaError("PTA_HOUSEHOLD_INACTIVE", "Your household's PTA membership is not currently active.");
  }

  return { organizationId, session, adult };
}
