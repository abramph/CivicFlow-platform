import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, type Permission, type Role } from "@/lib/rbac";
import { hasVerticalCapability } from "@/lib/vertical-capabilities";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { UnionError } from "./errors";

/**
 * Union Case Center (UNION-CASE-A) — the centralized authorization
 * choke-point for every case route/page, mirroring
 * hoa/architectural-requests-guard.ts's shape exactly: two entirely
 * separate access paths, never mixed.
 *   - Staff path (requireUnionCase{Read,Manage,NotesInternal,
 *     DeadlinesManage,Close}) — RBAC permission + org-level
 *     "caseManagement" capability (see vertical-capabilities.ts). No
 *     record-level scoping beyond organizationId: a staff member with the
 *     read permission sees every case in their organization.
 *   - Member path — no RBAC permission at all. requireUnionCaseMemberAccess()
 *     gates reading an *existing* case the caller owns; submitting a new
 *     one only requires an active OrgMember record (see
 *     requireUnionCaseSubmitterAccess()) — unlike ArchitecturalRequest,
 *     there is no ownership-type eligibility gate: any active member of a
 *     UNION-vertical org may submit their own case.
 */

async function requireUnionCaseManagementEnabled(organizationId: string): Promise<{ primaryVertical: string; status: string }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true, status: true },
  });
  if (!organization || !hasVerticalCapability(organization.primaryVertical, "caseManagement")) {
    throw new UnionError("UNION_CASE_MANAGEMENT_NOT_ENABLED", "This organization does not have Union Case Center enabled.");
  }
  if (organization.status !== "active") {
    throw new UnionError("UNION_ORGANIZATION_INACTIVE", "This organization is not currently active.");
  }
  return organization;
}

/** Non-throwing form, for call sites that render their own "not available"
 * messaging rather than letting an error propagate. */
export async function checkUnionCaseManagementAvailable(organizationId: string): Promise<{ available: boolean }> {
  try {
    await requireUnionCaseManagementEnabled(organizationId);
    return { available: true };
  } catch {
    return { available: false };
  }
}

async function requireUnionCaseAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requireUnionCaseManagementEnabled(organizationId);
  return { organizationId, session, role };
}

export async function requireUnionCaseRead() {
  return requireUnionCaseAccess(PERMISSIONS.UNION_CASES_READ);
}

export async function requireUnionCaseManage() {
  return requireUnionCaseAccess(PERMISSIONS.UNION_CASES_MANAGE);
}

export async function requireUnionCaseNotesInternal() {
  return requireUnionCaseAccess(PERMISSIONS.UNION_CASES_NOTES_INTERNAL);
}

export async function requireUnionCaseDeadlinesManage() {
  return requireUnionCaseAccess(PERMISSIONS.UNION_CASES_DEADLINES_MANAGE);
}

export async function requireUnionCaseClose() {
  return requireUnionCaseAccess(PERMISSIONS.UNION_CASES_CLOSE);
}

/** Page-component variant (redirect mode) — pages render their own "not
 * available" messaging on denial, not an unhandled error. Mirrors
 * getArchitecturalRequestsPageGate(). */
export async function getUnionCasesPageGate(permission: Permission) {
  const { organizationId, session, role, can } = await requirePermission(permission);
  let available = true;
  try {
    await requireUnionCaseManagementEnabled(organizationId);
  } catch {
    available = false;
  }
  return { organizationId, session, role, can, access: { available } };
}

export interface UnionCaseAccessContext {
  organizationId: string;
  caseId: string;
  role: Role;
}

/**
 * Resolves a specific case scoped strictly to the active organization — a
 * cross-tenant case id (belonging to a different organization) resolves to
 * "not found," never leaking whether the id exists elsewhere. Staff path
 * only; never trusts organizationId from the client (must already be
 * server-resolved by one of the requireUnionCase* functions above).
 */
export async function getUnionCaseAccessContext(organizationId: string, caseId: string, role: Role): Promise<UnionCaseAccessContext> {
  const unionCase = await prisma.unionCase.findFirst({ where: { id: caseId, organizationId }, select: { id: true } });
  if (!unionCase) {
    throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found in this organization.");
  }
  return { organizationId, caseId, role };
}

/**
 * Gates *creating* a new case: the caller must hold a real MEMBER web
 * session AND have an active OrgMember record in this organization. Unlike
 * requireArchitecturalRequestSubmissionEligibility(), there is no
 * relationship-type eligibility check — any active member of a
 * UNION-vertical org may submit their own case.
 */
export async function requireUnionCaseSubmitterAccess(organizationId: string): Promise<{ memberId: string }> {
  await requireUnionCaseManagementEnabled(organizationId);
  const memberSession = await requireMemberWebSession(organizationId);

  const member = await prisma.orgMember.findFirst({
    where: { id: memberSession.memberId, organizationId, membershipStatus: "active" },
    select: { id: true },
  });
  if (!member) {
    throw new UnionError("UNION_CASE_MEMBER_NOT_ACTIVE", "Only an active member of this organization can submit a case.");
  }

  return { memberId: member.id };
}

/**
 * Gates reading/acting on an *existing* case: the caller must hold a real
 * MEMBER web session AND be the case's own member. Scoped by
 * memberOrgMemberId directly (the case already carries the member's
 * identity) rather than re-checking membership status, since a membership
 * that later lapses must not retroactively hide a member's own case
 * history. Never returns internal (isPrivate) comments — callers must use
 * a member-scoped query for the comment thread, never the staff-side one.
 */
export async function requireUnionCaseMemberAccess(
  organizationId: string,
  caseId: string
): Promise<{ memberId: string; caseId: string }> {
  const memberSession = await requireMemberWebSession(organizationId);

  const unionCase = await prisma.unionCase.findFirst({
    where: { id: caseId, organizationId },
    select: { id: true, memberOrgMemberId: true },
  });
  if (!unionCase) {
    throw new UnionError("UNION_CASE_NOT_FOUND", "Case not found.");
  }
  if (unionCase.memberOrgMemberId !== memberSession.memberId) {
    throw new UnionError("UNION_CASE_NOT_YOURS", "You do not have access to this case.");
  }

  return { memberId: memberSession.memberId, caseId: unionCase.id };
}

/** Every case the caller (identified by their own MEMBER web session) has
 * ever submitted, in this organization — the scoping list for "My Cases" on
 * the member-facing list view. Never accepts a memberId from client input. */
export async function listMyUnionCases(organizationId: string) {
  const memberSession = await requireMemberWebSession(organizationId);
  return prisma.unionCase.findMany({
    where: { organizationId, memberOrgMemberId: memberSession.memberId },
    orderBy: { createdAt: "desc" },
  });
}
