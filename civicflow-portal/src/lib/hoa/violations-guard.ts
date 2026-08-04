import type { Violation } from "@prisma/client";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, type Permission, type Role } from "@/lib/rbac";
import { hasVerticalCapability } from "@/lib/vertical-capabilities";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { requireHoaCapability } from "./guard";
import { HoaError } from "./errors";

/**
 * HOA Violations MVP — the centralized authorization choke-point for every
 * violation-related route/page, exactly as docs/hoa-mvp-recommendation.md's
 * "one prerequisite" instructed (apply the lesson from PTA's own
 * retrospective on scattered access checks — see docs/pta-access-architecture.md).
 *
 * Two entirely separate access paths, never mixed:
 *   - Officer path (requireHoaViolation{Read,Write,Review,Resolve}) — RBAC
 *     permission + org-level "violations" capability. No property-level
 *     scoping: an officer with hoa:violations:read sees every property's
 *     violations in their organization.
 *   - Resident path (requireHoaViolationResidentAccess) — no RBAC
 *     permission at all, mirroring the documented pattern for
 *     parent/household self-service (see PERMISSIONS.HOA_VIOLATIONS_* in
 *     src/lib/rbac.ts). Authorized purely by an ACTIVE PropertyResident
 *     relationship to the violation's own property, scoped to a real
 *     MEMBER web session — never a raw organizationId/propertyId trusted
 *     from client input.
 */

async function requireHoaViolationsEnabled(organizationId: string): Promise<{ primaryVertical: string; status: string }> {
  const organization = await requireHoaCapability(organizationId);
  if (!hasVerticalCapability(organization.primaryVertical as never, "violations")) {
    throw new HoaError("HOA_VIOLATIONS_NOT_ENABLED", "Violation tracking is not enabled for this organization.");
  }
  return organization;
}

async function requireHoaViolationAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requireHoaViolationsEnabled(organizationId);
  return { organizationId, session, role };
}

export async function requireHoaViolationRead() {
  return requireHoaViolationAccess(PERMISSIONS.HOA_VIOLATIONS_READ);
}

export async function requireHoaViolationWrite() {
  return requireHoaViolationAccess(PERMISSIONS.HOA_VIOLATIONS_WRITE);
}

export async function requireHoaViolationReview() {
  return requireHoaViolationAccess(PERMISSIONS.HOA_VIOLATIONS_REVIEW);
}

export async function requireHoaViolationResolve() {
  return requireHoaViolationAccess(PERMISSIONS.HOA_VIOLATIONS_RESOLVE);
}

/** Page-component variant (redirect mode) — pages render their own "not
 * available" messaging on denial, not an unhandled error. Mirrors
 * getHoaPageGate() in guard.ts. */
export async function getHoaViolationsPageGate(permission: Permission) {
  const { organizationId, session, role, can } = await requirePermission(permission);
  let available = true;
  try {
    await requireHoaViolationsEnabled(organizationId);
  } catch {
    available = false;
  }
  return { organizationId, session, role, can, access: { available } };
}

export interface HoaViolationAccessContext {
  organizationId: string;
  violation: Violation;
  role: Role;
}

/**
 * Resolves a specific violation scoped strictly to the active organization
 * — a cross-tenant violation id resolves to "not found," never leaking
 * whether the id exists elsewhere. Officer path only; never trusts
 * organizationId from the client (must already be server-resolved by one
 * of the requireHoaViolation* functions above).
 */
export async function getHoaViolationAccessContext(
  organizationId: string,
  violationId: string,
  role: Role
): Promise<HoaViolationAccessContext> {
  const violation = await prisma.violation.findFirst({ where: { id: violationId, organizationId } });
  if (!violation) {
    throw new HoaError("HOA_VIOLATION_NOT_FOUND", "Violation not found in this organization.");
  }
  return { organizationId, violation, role };
}

/**
 * Resident self-service access: the caller must hold a real MEMBER web
 * session in this organization AND have an ACTIVE PropertyResident
 * relationship to the violation's property. A violation still in DRAFT
 * (not yet issued) is treated as not-yet-existing from the resident's
 * point of view — it's an internal officer working state, never
 * communicated to the resident yet.
 *
 * Returning this context is NOT the same as it being safe to serialize
 * directly to the resident — resolutionNotes and any private
 * ViolationComment rows must still be stripped by the caller (see
 * toResidentSafeViolation() in src/lib/hoa/violations.ts).
 */
export async function requireHoaViolationResidentAccess(
  organizationId: string,
  violationId: string
): Promise<{ memberId: string; violation: Violation }> {
  const memberSession = await requireMemberWebSession(organizationId);

  const violation = await prisma.violation.findFirst({ where: { id: violationId, organizationId } });
  if (!violation || violation.status === "DRAFT") {
    throw new HoaError("HOA_VIOLATION_NOT_FOUND", "Violation not found.");
  }

  const relationship = await prisma.propertyResident.findFirst({
    where: { organizationId, propertyId: violation.propertyId, orgMemberId: memberSession.memberId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!relationship) {
    throw new HoaError("HOA_VIOLATION_NOT_YOUR_PROPERTY", "You do not have access to this violation.");
  }

  return { memberId: memberSession.memberId, violation };
}

/**
 * Every property id the caller (identified by their own MEMBER web
 * session) is an ACTIVE resident/owner of, in this organization — the
 * scoping list for "my property's violations" on the resident-facing list
 * view. Never accepts a memberId from client input.
 */
export async function listMyResidentPropertyIds(organizationId: string): Promise<{ memberId: string; propertyIds: string[] }> {
  const memberSession = await requireMemberWebSession(organizationId);
  const rows = await prisma.propertyResident.findMany({
    where: { organizationId, orgMemberId: memberSession.memberId, status: "ACTIVE" },
    select: { propertyId: true },
  });
  return { memberId: memberSession.memberId, propertyIds: rows.map((r) => r.propertyId) };
}
