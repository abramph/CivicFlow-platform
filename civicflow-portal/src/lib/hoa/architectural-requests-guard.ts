import type { ArchitecturalRequest } from "@prisma/client";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, type Permission, type Role } from "@/lib/rbac";
import { hasVerticalCapability } from "@/lib/vertical-capabilities";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { requireHoaCapability } from "./guard";
import { HoaError } from "./errors";

/**
 * HOA Architectural Requests — the centralized authorization choke-point
 * for every architectural-request route/page, mirroring
 * violations-guard.ts's shape exactly (same two entirely-separate access
 * paths, never mixed):
 *   - Officer path (requireArchitecturalRequest{Read,Write,Review,Decide})
 *     — RBAC permission + org-level "architecturalRequests" capability.
 *     No property-level scoping: an officer with the read permission sees
 *     every property's requests in their organization.
 *   - Resident path — no RBAC permission at all. Two distinct resident
 *     operations, unlike Violations (which is resident-read-only):
 *     requireArchitecturalRequestSubmissionEligibility() gates *creating* a
 *     new request (an ACTIVE PropertyResident relationship of an eligible
 *     type), while requireArchitecturalRequestResidentAccess() gates
 *     reading/acting on an *existing* request the caller submitted.
 */

const ELIGIBLE_SUBMITTER_RELATIONSHIP_TYPES = ["OWNER", "CO_OWNER", "NON_RESIDENT_OWNER"] as const;

async function requireArchitecturalRequestsEnabled(organizationId: string): Promise<{ primaryVertical: string; status: string }> {
  const organization = await requireHoaCapability(organizationId);
  if (!hasVerticalCapability(organization.primaryVertical as never, "architecturalRequests")) {
    throw new HoaError("HOA_ARCHITECTURAL_REQUESTS_NOT_ENABLED", "Architectural request review is not enabled for this organization.");
  }
  return organization;
}

async function requireArchitecturalRequestAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requireArchitecturalRequestsEnabled(organizationId);
  return { organizationId, session, role };
}

export async function requireArchitecturalRequestRead() {
  return requireArchitecturalRequestAccess(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ);
}

export async function requireArchitecturalRequestWrite() {
  return requireArchitecturalRequestAccess(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_WRITE);
}

export async function requireArchitecturalRequestReview() {
  return requireArchitecturalRequestAccess(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW);
}

export async function requireArchitecturalRequestDecide() {
  return requireArchitecturalRequestAccess(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_DECIDE);
}

/** Page-component variant (redirect mode) — pages render their own "not
 * available" messaging on denial, not an unhandled error. Mirrors
 * getHoaViolationsPageGate(). */
export async function getArchitecturalRequestsPageGate(permission: Permission) {
  const { organizationId, session, role, can } = await requirePermission(permission);
  let available = true;
  try {
    await requireArchitecturalRequestsEnabled(organizationId);
  } catch {
    available = false;
  }
  return { organizationId, session, role, can, access: { available } };
}

export interface ArchitecturalRequestAccessContext {
  organizationId: string;
  request: ArchitecturalRequest;
  role: Role;
}

/**
 * Resolves a specific request scoped strictly to the active organization —
 * a cross-tenant request id resolves to "not found," never leaking whether
 * the id exists elsewhere. Officer path only; never trusts organizationId
 * from the client (must already be server-resolved by one of the
 * requireArchitecturalRequest* functions above).
 */
export async function getArchitecturalRequestAccessContext(
  organizationId: string,
  requestId: string,
  role: Role
): Promise<ArchitecturalRequestAccessContext> {
  const request = await prisma.architecturalRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!request) {
    throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found in this organization.");
  }
  return { organizationId, request, role };
}

/**
 * Gates *creating* a new request: the caller must hold a real MEMBER web
 * session in this organization AND have an ACTIVE PropertyResident
 * relationship to the given property whose relationshipType is one of
 * OWNER/CO_OWNER/NON_RESIDENT_OWNER. RESIDENT and TENANT relationships are
 * deliberately not eligible to self-submit in this MVP — architectural
 * modification requests are an ownership-accountability decision in most
 * HOA governing documents, and an officer/board member can record a
 * request on a non-eligible resident's behalf if a specific HOA's policy
 * requires it (no dedicated "submit on behalf of" UI ships in this MVP;
 * an officer can still create the row directly via the same service
 * function, just not through this specific resident-facing guard).
 */
export async function requireArchitecturalRequestSubmissionEligibility(
  organizationId: string,
  propertyId: string
): Promise<{ memberId: string; propertyId: string }> {
  const memberSession = await requireMemberWebSession(organizationId);

  const relationship = await prisma.propertyResident.findFirst({
    where: {
      organizationId,
      propertyId,
      orgMemberId: memberSession.memberId,
      status: "ACTIVE",
      relationshipType: { in: [...ELIGIBLE_SUBMITTER_RELATIONSHIP_TYPES] },
    },
    select: { id: true },
  });
  if (!relationship) {
    throw new HoaError(
      "HOA_ARCHITECTURAL_REQUEST_INELIGIBLE_RELATIONSHIP",
      "Only an owner, co-owner, or non-resident owner of this property can submit an architectural request."
    );
  }

  return { memberId: memberSession.memberId, propertyId };
}

/**
 * Gates reading/acting on an *existing* request: the caller must hold a
 * real MEMBER web session AND be the request's own submitter. Scoped by
 * submittedByOrgMemberId directly (the request already carries the
 * submitter's identity) rather than re-checking PropertyResident, since a
 * relationship that later ends must not retroactively hide a resident's
 * own submission history.
 */
export async function requireArchitecturalRequestResidentAccess(
  organizationId: string,
  requestId: string
): Promise<{ memberId: string; request: ArchitecturalRequest }> {
  const memberSession = await requireMemberWebSession(organizationId);

  const request = await prisma.architecturalRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!request) {
    throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_FOUND", "Architectural request not found.");
  }
  if (request.submittedByOrgMemberId !== memberSession.memberId) {
    throw new HoaError("HOA_ARCHITECTURAL_REQUEST_NOT_YOURS", "You do not have access to this architectural request.");
  }

  return { memberId: memberSession.memberId, request };
}

/** Every request the caller (identified by their own MEMBER web session)
 * has ever submitted, in this organization — the scoping list for "my
 * requests" on the resident-facing list view. Never accepts a memberId
 * from client input. */
export async function listMyArchitecturalRequests(organizationId: string) {
  const memberSession = await requireMemberWebSession(organizationId);
  return prisma.architecturalRequest.findMany({
    where: { organizationId, submittedByOrgMemberId: memberSession.memberId },
    orderBy: { createdAt: "desc" },
    include: { property: { select: { id: true, addressLine1: true, unitLabel: true, displayName: true } } },
  });
}

/** Every property id the caller is an ACTIVE resident/owner of AND holds
 * an eligible relationship type for — the scoping list for the "select a
 * property" dropdown on the new-request form. */
export async function listMyEligibleSubmissionProperties(organizationId: string): Promise<{ memberId: string; propertyIds: string[] }> {
  const memberSession = await requireMemberWebSession(organizationId);
  const rows = await prisma.propertyResident.findMany({
    where: {
      organizationId,
      orgMemberId: memberSession.memberId,
      status: "ACTIVE",
      relationshipType: { in: [...ELIGIBLE_SUBMITTER_RELATIONSHIP_TYPES] },
    },
    select: { propertyId: true },
  });
  return { memberId: memberSession.memberId, propertyIds: rows.map((r) => r.propertyId) };
}
