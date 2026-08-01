import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { HoaError } from "./errors";

/**
 * HOA Property/Resident service layer (PR #43 foundation only — see
 * docs/hoa-domain-model.md). Every function takes organizationId as an
 * explicit required parameter and scopes every Prisma query by it (tenant
 * isolation), mirroring labs/pta/households.ts's convention.
 *
 * Two invariants ("at most one ACTIVE relationship per property+member,"
 * "at most one ACTIVE primary contact per property") are enforced by real
 * partial unique indexes at the database level (see the schema-drift
 * warning on the PropertyResident model) — the checks in this file are a
 * friendlier pre-check for a nicer error message, not the actual safety
 * guarantee, which the database provides regardless of what this code
 * does or misses.
 */

// ─── Property ────────────────────────────────────────────────────────────

export interface CreatePropertyInput {
  organizationId: string;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  unitLabel?: string | null;
  buildingLabel?: string | null;
  propertyType?: "SINGLE_FAMILY" | "CONDO_UNIT" | "TOWNHOME" | "VACANT_LOT" | "COMMON_PROPERTY" | "OTHER";
  displayName?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

function assertValidAddress(addressLine1: string) {
  if (!addressLine1.trim()) {
    throw new HoaError("HOA_VALIDATION_ERROR", "Street address is required.");
  }
}

export async function createProperty(input: CreatePropertyInput) {
  assertValidAddress(input.addressLine1);

  const property = await prisma.property.create({
    data: {
      organizationId: input.organizationId,
      addressLine1: input.addressLine1.trim(),
      addressLine2: input.addressLine2?.trim() || null,
      city: input.city?.trim() || null,
      state: input.state?.trim() || null,
      zipCode: input.zipCode?.trim() || null,
      country: input.country?.trim() || null,
      unitLabel: input.unitLabel?.trim() || null,
      buildingLabel: input.buildingLabel?.trim() || null,
      propertyType: input.propertyType ?? "SINGLE_FAMILY",
      displayName: input.displayName?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "create",
    entityType: "hoa_property",
    entityId: property.id,
    // Never log notes (private, board-only) or full address in audit
    // metadata -- just enough to identify the record from the audit log
    // itself without duplicating personal/private data into a second store.
    metadata: { propertyType: property.propertyType },
  });

  return property;
}

export interface ListPropertiesFilters {
  status?: "ACTIVE" | "INACTIVE";
  propertyType?: "SINGLE_FAMILY" | "CONDO_UNIT" | "TOWNHOME" | "VACANT_LOT" | "COMMON_PROPERTY" | "OTHER";
  search?: string;
  /** Filter to only properties with no ACTIVE resident/owner at all —
   * powers the "properties with no active owner/contact" dashboard widget
   * and the equivalent directory filter. */
  noActiveResident?: boolean;
  take?: number;
  skip?: number;
}

export async function listProperties(organizationId: string, filters: ListPropertiesFilters = {}) {
  const take = Math.min(filters.take ?? 50, 200);
  const skip = filters.skip ?? 0;

  const where: Prisma.PropertyWhereInput = {
    organizationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.propertyType ? { propertyType: filters.propertyType } : {}),
    ...(filters.search
      ? {
          OR: [
            { addressLine1: { contains: filters.search, mode: "insensitive" } },
            { unitLabel: { contains: filters.search, mode: "insensitive" } },
            { displayName: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.noActiveResident ? { residents: { none: { status: "ACTIVE" } } } : {}),
  };

  const [properties, total] = await Promise.all([
    prisma.property.findMany({
      where,
      select: {
        id: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zipCode: true,
        unitLabel: true,
        buildingLabel: true,
        propertyType: true,
        displayName: true,
        status: true,
        billingMember: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { residents: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { addressLine1: "asc" },
      take,
      skip,
    }),
    prisma.property.count({ where }),
  ]);

  return { properties, total, take, skip };
}

export async function getProperty(organizationId: string, propertyId: string) {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    include: {
      billingMember: { select: { id: true, firstName: true, lastName: true, email: true } },
      residents: {
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include: { orgMember: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
      },
    },
  });
  if (!property) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }
  return property;
}

export interface UpdatePropertyInput {
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  unitLabel?: string | null;
  buildingLabel?: string | null;
  propertyType?: "SINGLE_FAMILY" | "CONDO_UNIT" | "TOWNHOME" | "VACANT_LOT" | "COMMON_PROPERTY" | "OTHER";
  displayName?: string | null;
  billingMemberId?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function updateProperty(organizationId: string, propertyId: string, input: UpdatePropertyInput) {
  const existing = await prisma.property.findFirst({ where: { id: propertyId, organizationId } });
  if (!existing) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }
  if (existing.status === "INACTIVE") {
    throw new HoaError("HOA_PROPERTY_ARCHIVED", "This property is archived and cannot be edited. Reactivate it first.");
  }
  if (input.addressLine1 !== undefined) assertValidAddress(input.addressLine1);

  if (input.billingMemberId) {
    const member = await prisma.orgMember.findFirst({ where: { id: input.billingMemberId, organizationId } });
    if (!member) {
      throw new HoaError("HOA_CROSS_TENANT_DENIED", "The selected billing member does not belong to this organization.");
    }
  }

  const property = await prisma.property.update({
    where: { id: propertyId },
    data: {
      ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1.trim() } : {}),
      ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2?.trim() || null } : {}),
      ...(input.city !== undefined ? { city: input.city?.trim() || null } : {}),
      ...(input.state !== undefined ? { state: input.state?.trim() || null } : {}),
      ...(input.zipCode !== undefined ? { zipCode: input.zipCode?.trim() || null } : {}),
      ...(input.country !== undefined ? { country: input.country?.trim() || null } : {}),
      ...(input.unitLabel !== undefined ? { unitLabel: input.unitLabel?.trim() || null } : {}),
      ...(input.buildingLabel !== undefined ? { buildingLabel: input.buildingLabel?.trim() || null } : {}),
      ...(input.propertyType !== undefined ? { propertyType: input.propertyType } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName?.trim() || null } : {}),
      ...(input.billingMemberId !== undefined ? { billingMemberId: input.billingMemberId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "update",
    entityType: "hoa_property",
    entityId: propertyId,
    metadata: { fields: Object.keys(input).filter((k) => k !== "actorUserId" && k !== "actorEmail") },
  });

  return property;
}

export async function archiveProperty(
  organizationId: string,
  propertyId: string,
  actor: { actorUserId: string; actorEmail?: string | null }
) {
  const existing = await prisma.property.findFirst({ where: { id: propertyId, organizationId } });
  if (!existing) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }
  if (existing.status === "INACTIVE") {
    return existing; // already archived -- idempotent, not an error
  }

  const property = await prisma.property.update({
    where: { id: propertyId },
    data: { status: "INACTIVE", archivedAt: new Date() },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.actorUserId,
    actorEmail: actor.actorEmail,
    action: "archive",
    entityType: "hoa_property",
    entityId: propertyId,
  });

  return property;
}

export async function reactivateProperty(
  organizationId: string,
  propertyId: string,
  actor: { actorUserId: string; actorEmail?: string | null }
) {
  const existing = await prisma.property.findFirst({ where: { id: propertyId, organizationId } });
  if (!existing) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }
  if (existing.status === "ACTIVE") {
    return existing; // already active -- idempotent, not an error
  }

  const property = await prisma.property.update({
    where: { id: propertyId },
    data: { status: "ACTIVE", archivedAt: null },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.actorUserId,
    actorEmail: actor.actorEmail,
    action: "reactivate",
    entityType: "hoa_property",
    entityId: propertyId,
  });

  return property;
}

// ─── PropertyResident ────────────────────────────────────────────────────

export interface AssignPropertyResidentInput {
  organizationId: string;
  propertyId: string;
  orgMemberId: string;
  relationshipType: "OWNER" | "CO_OWNER" | "RESIDENT" | "TENANT" | "NON_RESIDENT_OWNER" | "OTHER";
  isPrimaryContact?: boolean;
  ownershipPercentage?: number | null;
  moveInDate?: Date | null;
  actorUserId: string;
  actorEmail?: string | null;
}

function assertValidDateRange(moveInDate: Date | null | undefined, moveOutDate: Date | null | undefined) {
  if (moveInDate && moveOutDate && moveInDate.getTime() > moveOutDate.getTime()) {
    throw new HoaError("HOA_VALIDATION_ERROR", "Move-in date cannot be after move-out date.");
  }
}

export async function assignPropertyResident(input: AssignPropertyResidentInput) {
  const property = await prisma.property.findFirst({ where: { id: input.propertyId, organizationId: input.organizationId } });
  if (!property) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }
  if (property.status === "INACTIVE") {
    throw new HoaError("HOA_PROPERTY_ARCHIVED", "Cannot assign a resident to an archived property.");
  }

  // Cross-tenant member assignment check -- the member id must resolve
  // within THIS organization, never trusted from the client as already
  // valid.
  const member = await prisma.orgMember.findFirst({ where: { id: input.orgMemberId, organizationId: input.organizationId } });
  if (!member) {
    throw new HoaError("HOA_CROSS_TENANT_DENIED", "The selected member does not belong to this organization.");
  }

  // Friendly pre-check for "duplicate active relationship" -- the real
  // guarantee is the partial unique index (see schema.prisma), which this
  // create() below will hit if a concurrent request wins the race.
  const existingActive = await prisma.propertyResident.findFirst({
    where: { propertyId: input.propertyId, orgMemberId: input.orgMemberId, status: "ACTIVE" },
  });
  if (existingActive) {
    throw new HoaError("HOA_DUPLICATE_ACTIVE_RELATIONSHIP", "This member already has an active relationship to this property.");
  }

  try {
    const resident = await prisma.$transaction(async (tx) => {
      // "Only one ACTIVE primary contact per property" -- friendly
      // pre-check + explicit unset-then-set inside the same transaction
      // (the partial unique index is the real backstop against a
      // concurrent request racing this same unset-then-set).
      if (input.isPrimaryContact) {
        await tx.propertyResident.updateMany({
          where: { propertyId: input.propertyId, status: "ACTIVE", isPrimaryContact: true },
          data: { isPrimaryContact: false },
        });
      }

      return tx.propertyResident.create({
        data: {
          organizationId: input.organizationId,
          propertyId: input.propertyId,
          orgMemberId: input.orgMemberId,
          relationshipType: input.relationshipType,
          isPrimaryContact: input.isPrimaryContact ?? false,
          ownershipPercentage: input.ownershipPercentage ?? null,
          moveInDate: input.moveInDate ?? null,
        },
      });
    });

    await createAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "create",
      entityType: "hoa_property_resident",
      entityId: resident.id,
      metadata: { propertyId: input.propertyId, relationshipType: input.relationshipType },
    });

    return resident;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Lost a race against a concurrent assignment of the same
      // (property, member) pair, or a concurrent primary-contact set --
      // the database constraint is the actual source of truth here.
      throw new HoaError("HOA_DUPLICATE_ACTIVE_RELATIONSHIP", "This member already has an active relationship to this property.");
    }
    throw error;
  }
}

export interface UpdatePropertyResidentInput {
  relationshipType?: "OWNER" | "CO_OWNER" | "RESIDENT" | "TENANT" | "NON_RESIDENT_OWNER" | "OTHER";
  isPrimaryContact?: boolean;
  ownershipPercentage?: number | null;
  actorUserId: string;
  actorEmail?: string | null;
}

export async function updatePropertyResident(organizationId: string, residentId: string, input: UpdatePropertyResidentInput) {
  const existing = await prisma.propertyResident.findFirst({ where: { id: residentId, organizationId } });
  if (!existing) {
    throw new HoaError("HOA_RESIDENT_NOT_FOUND", "Resident relationship not found in this organization.");
  }
  if (existing.status === "ENDED") {
    throw new HoaError("HOA_RELATIONSHIP_ALREADY_ENDED", "This relationship has already ended and cannot be edited. Create a new one instead.");
  }

  try {
    const resident = await prisma.$transaction(async (tx) => {
      if (input.isPrimaryContact) {
        await tx.propertyResident.updateMany({
          where: { propertyId: existing.propertyId, status: "ACTIVE", isPrimaryContact: true, id: { not: residentId } },
          data: { isPrimaryContact: false },
        });
      }
      return tx.propertyResident.update({
        where: { id: residentId },
        data: {
          ...(input.relationshipType !== undefined ? { relationshipType: input.relationshipType } : {}),
          ...(input.isPrimaryContact !== undefined ? { isPrimaryContact: input.isPrimaryContact } : {}),
          ...(input.ownershipPercentage !== undefined ? { ownershipPercentage: input.ownershipPercentage } : {}),
        },
      });
    });

    await createAuditEvent({
      organizationId,
      actorUserId: input.actorUserId,
      actorEmail: input.actorEmail,
      action: "update",
      entityType: "hoa_property_resident",
      entityId: residentId,
    });

    return resident;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new HoaError("HOA_DUPLICATE_ACTIVE_RELATIONSHIP", "Another active primary contact already exists for this property.");
    }
    throw error;
  }
}

export async function endPropertyResidentRelationship(
  organizationId: string,
  residentId: string,
  input: { moveOutDate?: Date | null; actorUserId: string; actorEmail?: string | null }
) {
  const existing = await prisma.propertyResident.findFirst({ where: { id: residentId, organizationId } });
  if (!existing) {
    throw new HoaError("HOA_RESIDENT_NOT_FOUND", "Resident relationship not found in this organization.");
  }
  if (existing.status === "ENDED") {
    throw new HoaError("HOA_RELATIONSHIP_ALREADY_ENDED", "This relationship has already ended.");
  }

  const moveOutDate = input.moveOutDate ?? new Date();
  assertValidDateRange(existing.moveInDate, moveOutDate);

  const resident = await prisma.propertyResident.update({
    where: { id: residentId },
    data: { status: "ENDED", moveOutDate, isPrimaryContact: false },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "end",
    entityType: "hoa_property_resident",
    entityId: residentId,
  });

  return resident;
}

/** Full history (ACTIVE and ENDED) for one property, most recent first. */
export async function getPropertyResidentHistory(organizationId: string, propertyId: string) {
  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId } });
  if (!property) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }

  return prisma.propertyResident.findMany({
    where: { propertyId, organizationId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { orgMember: { select: { id: true, firstName: true, lastName: true, email: true } } },
  });
}

/** Active-only residents for one property — the common case for the
 * property detail page's "current residents" section. */
export async function listActivePropertyResidents(organizationId: string, propertyId: string) {
  const property = await prisma.property.findFirst({ where: { id: propertyId, organizationId } });
  if (!property) {
    throw new HoaError("HOA_PROPERTY_NOT_FOUND", "Property not found in this organization.");
  }

  return prisma.propertyResident.findMany({
    where: { propertyId, organizationId, status: "ACTIVE" },
    orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }],
    include: { orgMember: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
  });
}
