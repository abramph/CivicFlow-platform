import type { ImportKind } from "@prisma/client";
import { ForbiddenError } from "@/lib/auth-guards";
import { requirePtaVertical } from "@/lib/labs/pta/guard";
import { requireHoaCapability } from "@/lib/hoa/guard";
import { PERMISSIONS, type Permission } from "@/lib/rbac";

export const IMPORT_KINDS: ImportKind[] = ["COMMUNITY_MEMBERS", "PTA_HOUSEHOLDS", "HOA_PROPERTIES"];

/**
 * The one place that decides whether the caller may act on a batch of a
 * given kind — shared by every route that either creates a batch OR causes
 * it to actually execute writes (POST /api/imports, .../start, .../resume).
 *
 * Originally this lived only in POST /api/imports (create-time). A security
 * review of PR C found that start/resume checked only the generic
 * imports:create/imports:resume permission and never re-verified the
 * domain-specific permission or vertical-capability guard for the batch's
 * actual importKind before calling executeBatch()/resumeBatch() — meaning an
 * org that used the per-org custom role editor (OrgRolePermissionSet) to
 * grant a role generic import permissions without the matching
 * pta:households:manage/hoa:properties:write/hoa:residents:write grant could
 * still trigger real household/property writes via start/resume, bypassing
 * the create-time gate entirely. Every route that can cause executeBatch()
 * to run real writes must call this first.
 *
 * Each kind requires both the generic imports:* permission (checked by the
 * caller before this runs) AND a domain-specific write permission, mirroring
 * the existing /api/import route's per-type dual-gate shape. PTA/HOA
 * additionally require the same vertical-capability check
 * (Organization.primaryVertical) requirePtaAccess()/requireHoaPropertyWrite()
 * already enforce elsewhere — an org whose STAFF role happens to hold
 * pta:households:manage still can't act on a PTA_HOUSEHOLDS batch unless the
 * org actually IS a PTA organization.
 */
export async function authorizeImportKind(
  importKind: ImportKind,
  organizationId: string,
  can: (permission: Permission) => boolean
): Promise<void> {
  if (importKind === "PTA_HOUSEHOLDS") {
    await requirePtaVertical(organizationId);
    if (!can(PERMISSIONS.PTA_HOUSEHOLDS_MANAGE)) {
      throw new ForbiddenError("Permission denied: pta:households:manage is required to act on this PTA household import.");
    }
    return;
  }
  if (importKind === "HOA_PROPERTIES") {
    await requireHoaCapability(organizationId);
    if (!can(PERMISSIONS.HOA_PROPERTIES_WRITE) || !can(PERMISSIONS.HOA_RESIDENTS_WRITE)) {
      throw new ForbiddenError("Permission denied: hoa:properties:write and hoa:residents:write are required to act on this HOA property import.");
    }
    return;
  }
  if (!can("members:write")) {
    throw new ForbiddenError("Permission denied: members:write is required to act on this Community member import.");
  }
}

/**
 * Read-side sibling of authorizeImportKind() — a security review of PR C
 * found that GET /api/imports/[id] and its server page returned real PII
 * (PTA household primary-contact name/email/phone; HOA property owner
 * name/email, via attachFieldComparisons()'s PTA/HOA branches) to any
 * caller holding only the generic imports:read permission, with no check
 * for the domain-specific read permissions (pta:directory:read,
 * hoa:properties:read/hoa:residents:read) that gate this same data
 * everywhere else in the app. No default role can trigger this (every
 * built-in role holding imports:read also holds the matching domain-read
 * permission), but the per-org custom role editor
 * (OrgRolePermissionSet/src/app/api/settings/role-permissions/route.ts)
 * allows an org owner to construct exactly this gap (e.g. an "import-only"
 * or reporting role scoped to imports:read alone) with no guardrail.
 * COMMUNITY_MEMBERS is deliberately left unchecked here — that gap
 * pre-dates this PR and isn't something this function's job to fix.
 */
export function authorizeImportKindRead(importKind: ImportKind, can: (permission: Permission) => boolean): void {
  if (importKind === "PTA_HOUSEHOLDS" && !can(PERMISSIONS.PTA_DIRECTORY_READ)) {
    throw new ForbiddenError("Permission denied: pta:directory:read is required to view this PTA household import.");
  }
  if (importKind === "HOA_PROPERTIES" && (!can(PERMISSIONS.HOA_PROPERTIES_READ) || !can(PERMISSIONS.HOA_RESIDENTS_READ))) {
    throw new ForbiddenError("Permission denied: hoa:properties:read and hoa:residents:read are required to view this HOA property import.");
  }
}
