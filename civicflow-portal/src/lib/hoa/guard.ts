import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, type Permission, type Role } from "@/lib/rbac";
import { hasVerticalCapability } from "@/lib/vertical-capabilities";
import { HoaError } from "./errors";

/**
 * HOA Property/Resident foundation (PR #43) — the sole authoritative gate
 * is `Organization.primaryVertical === "HOA"` (via the central
 * getVerticalCapabilities() resolver, not a raw `=== "HOA"` check —
 * see src/lib/vertical-capabilities.ts) plus the organization being
 * active. Mirrors labs/pta/guard.ts's requirePtaVertical() in shape.
 */
export async function requireHoaCapability(organizationId: string): Promise<{ primaryVertical: string; status: string }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true, status: true },
  });
  if (!organization || !hasVerticalCapability(organization.primaryVertical, "properties")) {
    throw new HoaError("HOA_ORGANIZATION_NOT_HOA_VERTICAL", "This organization does not have HOA property management enabled.");
  }
  if (organization.status !== "active") {
    throw new HoaError("HOA_ORGANIZATION_INACTIVE", "This organization is not currently active.");
  }
  return organization;
}

/** Non-throwing form, for call sites that render their own "not available"
 * messaging rather than letting an error propagate. */
export async function checkHoaCapabilityAvailable(organizationId: string): Promise<{ available: boolean }> {
  try {
    await requireHoaCapability(organizationId);
    return { available: true };
  } catch {
    return { available: false };
  }
}

async function requireHoaAccess(permission: Permission) {
  const { organizationId, session, role } = await requirePermission(permission, "throw");
  await requireHoaCapability(organizationId);
  return { organizationId, session, role };
}

/** The composed guard every officer-facing property-read route/page must
 * call first: tenant RBAC permission AND the HOA capability check above. */
export async function requireHoaPropertyRead() {
  return requireHoaAccess(PERMISSIONS.HOA_PROPERTIES_READ);
}

export async function requireHoaPropertyWrite() {
  return requireHoaAccess(PERMISSIONS.HOA_PROPERTIES_WRITE);
}

export async function requireHoaResidentRead() {
  return requireHoaAccess(PERMISSIONS.HOA_RESIDENTS_READ);
}

export async function requireHoaResidentWrite() {
  return requireHoaAccess(PERMISSIONS.HOA_RESIDENTS_WRITE);
}

/** Page-component variant (redirect mode) — pages should render their own
 * "not available" messaging on denial, not throw an unhandled error.
 * Mirrors labs/pta/guard.ts's getPtaPageGate(). */
export async function getHoaPageGate(permission: Permission) {
  const { organizationId, session, role, can } = await requirePermission(permission);
  let available = true;
  try {
    await requireHoaCapability(organizationId);
  } catch {
    available = false;
  }
  return { organizationId, session, role, can, access: { available } };
}

export interface HoaPropertyAccessContext {
  organizationId: string;
  propertyId: string;
  property: {
    id: string;
    addressLine1: string;
    propertyType: string;
    status: string;
    billingMemberId: string | null;
  };
  role: Role;
  permissions: Permission[];
}

/**
 * Resolves a specific property scoped strictly to the active organization
 * — a cross-tenant property id (belonging to a different organization)
 * resolves to "not found," never leaking whether the id exists elsewhere.
 * Never trusts organizationId from the client; it must already be
 * server-resolved (e.g. from requireHoaPropertyRead()).
 */
export async function getHoaPropertyAccessContext(
  organizationId: string,
  propertyId: string,
  role: Role
): Promise<HoaPropertyAccessContext> {
  await requireHoaCapability(organizationId);

  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    select: { id: true, addressLine1: true, propertyType: true, status: true, billingMemberId: true },
  });
  if (!property) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }

  const { getEffectivePermissions } = await import("@/lib/role-permissions");
  const permissions = await getEffectivePermissions(organizationId, role);

  return { organizationId, propertyId, property, role, permissions };
}
