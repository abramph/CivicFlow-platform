/**
 * Unestra Cloud — Administrative Seat Calculation (CLOUD-SEAT-B)
 *
 * Builds on the capability-based classification in admin-seat-policy.ts
 * (CLOUD-SEAT-A) to answer the actual entitlement questions: how many
 * administrative seats does this org get, how many are in use, and how many
 * remain. This module is calculation only — server-side ENFORCEMENT (denying
 * a mutation that would exceed the limit) is CLOUD-SEAT-C.
 *
 * Domain model (Organization fields added in this migration):
 *   - includedAdminSeats   — NOT stored. Derived per-request from the org's
 *     pricing vertical via INCLUDED_ADMIN_SEATS below, so a future pricing
 *     change to the included-seat count never requires a backfill.
 *   - adminSeatOverride    — stored, platform-admin-granted additive
 *     adjustment. Never negative, never self-editable by the org itself
 *     (CLOUD-SEAT-E enforces that at the API layer). Full grant/change/
 *     remove/expire history lives in AuditEvent, not a separate table.
 *   - purchasedAdminSeats  — stored, always 0 at launch. Deliberately never
 *     sold, never shown in any UI — exists purely so a future paid seat pack
 *     can populate it without a schema redesign.
 *   - effectiveAdminSeatLimit = includedAdminSeats + adminSeatOverride + purchasedAdminSeats
 *   - usedAdminSeats       — count of unique users in this org currently
 *     holding a seat-consuming role (per requiresAdministrativeSeat).
 *   - availableAdminSeats  = max(0, effectiveAdminSeatLimit - usedAdminSeats)
 *
 * A note on "pending privileged invitations reserve a seat": this codebase
 * has no pending-invitation state for staff/admin roles to reserve against.
 * `MemberInvite` is a constituent (OrgMember) self-service portal-access
 * invite that always lands on the MEMBER role (never seat-consuming) — see
 * accept-invite.ts. The actual staff/admin "invite" flow
 * (POST /api/organization-memberships) creates the User and the privileged
 * OrganizationMembership SYNCHRONOUSLY, with no intermediate pending row.
 * There is therefore no reservation window to model: usedAdminSeats already
 * reflects reality the instant a privileged membership exists, and
 * CLOUD-SEAT-C's enforcement point is a pre-check immediately before that
 * synchronous create/update, not a separate reserve/release lifecycle.
 *
 * Seat counting only ever queries OrganizationMembership, never
 * PlatformAccess (the separate model backing platform-level SUPER_ADMIN/
 * support reach — see org-context.ts). That is what makes "platform-level
 * access must not consume a seat in every org merely from platform reach"
 * true by construction, with no special-casing required here.
 */
import type { OrganizationVertical } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type Role, ROLES } from "@/lib/rbac";

const ALL_ROLES = Object.keys(ROLES) as Role[];
import { resolvePricingVertical, type PricingVertical } from "@/lib/plans";
import { roleRequiresAdministrativeSeat } from "@/lib/admin-seat-policy";

/** Approved per-vertical included administrative seats (base subscription
 * price is unaffected by this — see docs/unestra-cloud-pricing-architecture.md). */
export const INCLUDED_ADMIN_SEATS: Record<PricingVertical, number> = {
  PTA: 10,
  COMMUNITY: 10,
  CHURCH: 15,
  UNION: 15,
};

export function includedAdminSeatsFor(vertical: OrganizationVertical): number {
  return INCLUDED_ADMIN_SEATS[resolvePricingVertical(vertical)];
}

/** Roles ever assignable to a real OrganizationMembership row. MEMBER is
 * excluded — getEffectivePermissions() hard-rails it to zero permissions, so
 * it can never require a seat and including it would just waste a query. */
const MEMBERSHIP_ROLES: readonly Role[] = ALL_ROLES.filter((role) => role !== "MEMBER");

/**
 * Which of this org's assignable roles currently require an administrative
 * seat, honoring any OrgRolePermissionSet customization. Computed once (up
 * to 6 permission-resolution calls) so the actual membership count query
 * below is a single indexed lookup rather than N row-by-row checks.
 */
async function seatConsumingRoles(organizationId: string): Promise<Role[]> {
  const results = await Promise.all(
    MEMBERSHIP_ROLES.map(async (role) => ({
      role,
      requiresSeat: await roleRequiresAdministrativeSeat(organizationId, role),
    }))
  );
  return results.filter((r) => r.requiresSeat).map((r) => r.role);
}

/**
 * Count of unique users currently holding a seat-consuming role in this org.
 * Only `status: "active"` memberships count — a deactivated/suspended
 * administrator frees their seat immediately (explicit requirement: seat
 * enforcement must never be the reason an org can't deactivate someone).
 * "Unique user" falls out of the schema for free: OrganizationMembership has
 * a hard @@unique([organizationId, userId]) constraint, so a user can hold
 * at most one role — and therefore consume at most one seat — per org,
 * regardless of how many privileged permissions that single role carries.
 */
export async function getUsedAdminSeats(organizationId: string): Promise<number> {
  const seatRoles = await seatConsumingRoles(organizationId);
  if (seatRoles.length === 0) return 0;
  return prisma.organizationMembership.count({
    where: { organizationId, status: "active", role: { in: seatRoles } },
  });
}

export interface AdminSeatSummary {
  vertical: PricingVertical;
  includedAdminSeats: number;
  adminSeatOverride: number;
  purchasedAdminSeats: number;
  effectiveAdminSeatLimit: number;
  usedAdminSeats: number;
  availableAdminSeats: number;
  /** True once usage exceeds the effective limit (e.g. after an override was
   * reduced or expired). Never auto-corrected by removing access — see
   * CLOUD-SEAT-C — this flag only blocks NEW privileged assignments. */
  overLimit: boolean;
}

/**
 * The single, consolidated seat snapshot for an organization — the
 * authoritative source for both display (CLOUD-SEAT-E UI) and the
 * pre-mutation check enforcement will use (CLOUD-SEAT-C). Billing-exempt/
 * demo/trial status intentionally has no bearing here: seat allowance is a
 * function of vertical + override + purchased seats only, never of billing
 * state, so an exempt org's seats are calculated exactly like a paying org's.
 */
export async function getAdminSeatSummary(organizationId: string): Promise<AdminSeatSummary> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      primaryVertical: true,
      adminSeatOverride: true,
      purchasedAdminSeats: true,
    },
  });

  const vertical = resolvePricingVertical(org.primaryVertical);
  const includedAdminSeats = INCLUDED_ADMIN_SEATS[vertical];
  const effectiveAdminSeatLimit = includedAdminSeats + org.adminSeatOverride + org.purchasedAdminSeats;
  const usedAdminSeats = await getUsedAdminSeats(organizationId);

  return {
    vertical,
    includedAdminSeats,
    adminSeatOverride: org.adminSeatOverride,
    purchasedAdminSeats: org.purchasedAdminSeats,
    effectiveAdminSeatLimit,
    usedAdminSeats,
    availableAdminSeats: Math.max(0, effectiveAdminSeatLimit - usedAdminSeats),
    overLimit: usedAdminSeats > effectiveAdminSeatLimit,
  };
}

/** Whether granting one more seat-consuming role right now would fit within
 * the org's effective limit. Pure read — CLOUD-SEAT-C wraps this in the
 * actual transactional enforcement (this alone is not concurrency-safe). */
export async function hasAvailableAdminSeat(organizationId: string): Promise<boolean> {
  const summary = await getAdminSeatSummary(organizationId);
  return summary.availableAdminSeats > 0;
}
