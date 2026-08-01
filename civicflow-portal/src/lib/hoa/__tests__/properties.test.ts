import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findFirstProperty = vi.fn();
const createProperty = vi.fn();
const updateProperty = vi.fn();
const findManyProperty = vi.fn();
const countProperty = vi.fn();
const findFirstOrgMember = vi.fn();
const findFirstPropertyResident = vi.fn();
const createPropertyResident = vi.fn();
const updatePropertyResident = vi.fn();
const updateManyPropertyResident = vi.fn();
const findManyPropertyResident = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

const txClient = {
  propertyResident: {
    updateMany: (...a: unknown[]) => updateManyPropertyResident(...a),
    create: (...a: unknown[]) => createPropertyResident(...a),
    update: (...a: unknown[]) => updatePropertyResident(...a),
  },
};
const transaction = vi.fn((fn: (tx: typeof txClient) => unknown) => fn(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: Parameters<typeof transaction>) => transaction(...a),
    property: {
      findFirst: (...a: unknown[]) => findFirstProperty(...a),
      create: (...a: unknown[]) => createProperty(...a),
      update: (...a: unknown[]) => updateProperty(...a),
      findMany: (...a: unknown[]) => findManyProperty(...a),
      count: (...a: unknown[]) => countProperty(...a),
    },
    orgMember: { findFirst: (...a: unknown[]) => findFirstOrgMember(...a) },
    propertyResident: {
      findFirst: (...a: unknown[]) => findFirstPropertyResident(...a),
      create: (...a: unknown[]) => createPropertyResident(...a),
      update: (...a: unknown[]) => updatePropertyResident(...a),
      updateMany: (...a: unknown[]) => updateManyPropertyResident(...a),
      findMany: (...a: unknown[]) => findManyPropertyResident(...a),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...a: unknown[]) => createAuditEvent(...a),
}));

const actor = { actorUserId: "user-1", actorEmail: "board@oakridgehoa.example" };

beforeEach(() => vi.clearAllMocks());

describe("createProperty", () => {
  it("rejects an empty street address", async () => {
    const { createProperty: create } = await import("../properties");
    await expect(create({ organizationId: "org-1", addressLine1: "   ", ...actor })).rejects.toMatchObject({ code: "HOA_VALIDATION_ERROR" });
    expect(createProperty).not.toHaveBeenCalled();
  });

  it("creates the property and writes an audit event without logging notes", async () => {
    createProperty.mockResolvedValueOnce({ id: "prop-1", propertyType: "SINGLE_FAMILY" });
    const { createProperty: create } = await import("../properties");
    const result = await create({ organizationId: "org-1", addressLine1: "142 Oak Ridge Drive", notes: "Private board note", ...actor });

    expect(result.id).toBe("prop-1");
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create", entityType: "hoa_property", metadata: { propertyType: "SINGLE_FAMILY" } })
    );
    // The private note must never appear in the audit metadata.
    const metadataArg = createAuditEvent.mock.calls[0][0].metadata;
    expect(JSON.stringify(metadataArg)).not.toContain("Private board note");
  });
});

describe("getProperty", () => {
  it("throws HOA_PROPERTY_NOT_FOUND for a cross-tenant property id", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { getProperty } = await import("../properties");
    await expect(getProperty("org-1", "prop-from-another-org")).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });
  });
});

describe("updateProperty", () => {
  it("blocks editing an archived property", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "INACTIVE" });
    const { updateProperty: update } = await import("../properties");
    await expect(update("org-1", "prop-1", { addressLine1: "New Address", ...actor })).rejects.toMatchObject({ code: "HOA_PROPERTY_ARCHIVED" });
    expect(updateProperty).not.toHaveBeenCalled();
  });

  it("rejects a billingMemberId that belongs to a different organization", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce(null); // cross-tenant member lookup fails
    const { updateProperty: update } = await import("../properties");
    await expect(update("org-1", "prop-1", { billingMemberId: "member-from-another-org", ...actor })).rejects.toMatchObject({
      code: "HOA_CROSS_TENANT_DENIED",
    });
  });
});

describe("archiveProperty / reactivateProperty", () => {
  it("archiveProperty is idempotent -- archiving an already-archived property is a no-op, not an error", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "INACTIVE" });
    const { archiveProperty } = await import("../properties");
    const result = await archiveProperty("org-1", "prop-1", actor);
    expect(result.status).toBe("INACTIVE");
    expect(updateProperty).not.toHaveBeenCalled();
  });

  it("reactivateProperty is idempotent -- reactivating an already-active property is a no-op", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    const { reactivateProperty } = await import("../properties");
    const result = await reactivateProperty("org-1", "prop-1", actor);
    expect(result.status).toBe("ACTIVE");
    expect(updateProperty).not.toHaveBeenCalled();
  });

  it("archiveProperty not found throws HOA_PROPERTY_NOT_FOUND", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { archiveProperty } = await import("../properties");
    await expect(archiveProperty("org-1", "prop-missing", actor)).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });
  });
});

describe("assignPropertyResident", () => {
  it("throws HOA_PROPERTY_NOT_FOUND for a cross-tenant property id", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { assignPropertyResident } = await import("../properties");
    await expect(
      assignPropertyResident({ organizationId: "org-1", propertyId: "prop-other-org", orgMemberId: "member-1", relationshipType: "OWNER", ...actor })
    ).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });
  });

  it("blocks assigning a resident to an archived property", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "INACTIVE" });
    const { assignPropertyResident } = await import("../properties");
    await expect(
      assignPropertyResident({ organizationId: "org-1", propertyId: "prop-1", orgMemberId: "member-1", relationshipType: "OWNER", ...actor })
    ).rejects.toMatchObject({ code: "HOA_PROPERTY_ARCHIVED" });
  });

  it("denies a member id that belongs to a different organization", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce(null);
    const { assignPropertyResident } = await import("../properties");
    await expect(
      assignPropertyResident({ organizationId: "org-1", propertyId: "prop-1", orgMemberId: "member-from-another-org", relationshipType: "TENANT", ...actor })
    ).rejects.toMatchObject({ code: "HOA_CROSS_TENANT_DENIED" });
    expect(createPropertyResident).not.toHaveBeenCalled();
  });

  it("rejects a duplicate active relationship for the same (property, member) pair (friendly pre-check)", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });
    findFirstPropertyResident.mockResolvedValueOnce({ id: "existing-relationship" });
    const { assignPropertyResident } = await import("../properties");
    await expect(
      assignPropertyResident({ organizationId: "org-1", propertyId: "prop-1", orgMemberId: "member-1", relationshipType: "TENANT", ...actor })
    ).rejects.toMatchObject({ code: "HOA_DUPLICATE_ACTIVE_RELATIONSHIP" });
    expect(createPropertyResident).not.toHaveBeenCalled();
  });

  it("translates a P2002 on the (property, member) unique index (lost a real concurrency race) into HOA_DUPLICATE_ACTIVE_RELATIONSHIP", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });
    findFirstPropertyResident.mockResolvedValueOnce(null); // pre-check passes...
    createPropertyResident.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["propertyId", "orgMemberId"] },
      })
    );
    const { assignPropertyResident } = await import("../properties");
    await expect(
      assignPropertyResident({ organizationId: "org-1", propertyId: "prop-1", orgMemberId: "member-1", relationshipType: "TENANT", ...actor })
    ).rejects.toMatchObject({ code: "HOA_DUPLICATE_ACTIVE_RELATIONSHIP" });
  });

  it("translates a P2002 on the one-primary-contact-per-property unique index (lost a real concurrency race) into HOA_PRIMARY_CONTACT_CONFLICT", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1" });
    findFirstPropertyResident.mockResolvedValueOnce(null); // pre-check passes...
    createPropertyResident.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["propertyId"] },
      })
    );
    const { assignPropertyResident } = await import("../properties");
    await expect(
      assignPropertyResident({ organizationId: "org-1", propertyId: "prop-1", orgMemberId: "member-1", relationshipType: "TENANT", isPrimaryContact: true, ...actor })
    ).rejects.toMatchObject({ code: "HOA_PRIMARY_CONTACT_CONFLICT" });
  });

  it("unsets any existing primary contact before creating a new one flagged isPrimaryContact", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-2" });
    findFirstPropertyResident.mockResolvedValueOnce(null);
    createPropertyResident.mockResolvedValueOnce({ id: "resident-2", isPrimaryContact: true });

    const { assignPropertyResident } = await import("../properties");
    await assignPropertyResident({ organizationId: "org-1", propertyId: "prop-1", orgMemberId: "member-2", relationshipType: "OWNER", isPrimaryContact: true, ...actor });

    expect(updateManyPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: "prop-1", status: "ACTIVE", isPrimaryContact: true }, data: { isPrimaryContact: false } })
    );
  });

  it("does not touch existing primary-contact rows when isPrimaryContact isn't requested", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1", status: "ACTIVE" });
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-3" });
    findFirstPropertyResident.mockResolvedValueOnce(null);
    createPropertyResident.mockResolvedValueOnce({ id: "resident-3" });

    const { assignPropertyResident } = await import("../properties");
    await assignPropertyResident({ organizationId: "org-1", propertyId: "prop-1", orgMemberId: "member-3", relationshipType: "TENANT", ...actor });

    expect(updateManyPropertyResident).not.toHaveBeenCalled();
  });
});

describe("updatePropertyResident", () => {
  it("throws HOA_RESIDENT_NOT_FOUND for a cross-tenant resident id", async () => {
    findFirstPropertyResident.mockResolvedValueOnce(null);
    const { updatePropertyResident: update } = await import("../properties");
    await expect(update("org-1", "resident-other-org", { ...actor })).rejects.toMatchObject({ code: "HOA_RESIDENT_NOT_FOUND" });
  });

  it("blocks editing an already-ended relationship", async () => {
    findFirstPropertyResident.mockResolvedValueOnce({ id: "resident-1", status: "ENDED", propertyId: "prop-1" });
    const { updatePropertyResident: update } = await import("../properties");
    await expect(update("org-1", "resident-1", { relationshipType: "OWNER", ...actor })).rejects.toMatchObject({
      code: "HOA_RELATIONSHIP_ALREADY_ENDED",
    });
  });

  it("clears a stale ownershipPercentage when relationshipType moves away from OWNER/CO_OWNER", async () => {
    findFirstPropertyResident.mockResolvedValueOnce({
      id: "resident-1",
      status: "ACTIVE",
      propertyId: "prop-1",
      relationshipType: "OWNER",
      ownershipPercentage: 50,
    });
    updatePropertyResident.mockResolvedValueOnce({ id: "resident-1" });
    const { updatePropertyResident: update } = await import("../properties");
    await update("org-1", "resident-1", { relationshipType: "TENANT", ...actor });
    expect(updatePropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ relationshipType: "TENANT", ownershipPercentage: null }) })
    );
  });

  it("does not clear ownershipPercentage when the caller explicitly sets a new one in the same call", async () => {
    findFirstPropertyResident.mockResolvedValueOnce({
      id: "resident-1",
      status: "ACTIVE",
      propertyId: "prop-1",
      relationshipType: "OWNER",
      ownershipPercentage: 50,
    });
    updatePropertyResident.mockResolvedValueOnce({ id: "resident-1" });
    const { updatePropertyResident: update } = await import("../properties");
    await update("org-1", "resident-1", { relationshipType: "TENANT", ownershipPercentage: 25, ...actor });
    expect(updatePropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownershipPercentage: 25 }) })
    );
  });

  it("does not clear ownershipPercentage for an existing OWNER when relationshipType is not part of the update", async () => {
    findFirstPropertyResident.mockResolvedValueOnce({
      id: "resident-1",
      status: "ACTIVE",
      propertyId: "prop-1",
      relationshipType: "OWNER",
      ownershipPercentage: 100,
    });
    updatePropertyResident.mockResolvedValueOnce({ id: "resident-1" });
    const { updatePropertyResident: update } = await import("../properties");
    await update("org-1", "resident-1", { isPrimaryContact: true, ...actor });
    const dataArg = updatePropertyResident.mock.calls[0][0].data;
    expect(dataArg).not.toHaveProperty("ownershipPercentage");
  });
});

describe("endPropertyResidentRelationship", () => {
  it("throws HOA_RESIDENT_NOT_FOUND for a cross-tenant resident id", async () => {
    findFirstPropertyResident.mockResolvedValueOnce(null);
    const { endPropertyResidentRelationship } = await import("../properties");
    await expect(endPropertyResidentRelationship("org-1", "resident-other-org", { ...actor })).rejects.toMatchObject({
      code: "HOA_RESIDENT_NOT_FOUND",
    });
  });

  it("blocks ending a relationship that's already ended", async () => {
    findFirstPropertyResident.mockResolvedValueOnce({ id: "resident-1", status: "ENDED" });
    const { endPropertyResidentRelationship } = await import("../properties");
    await expect(endPropertyResidentRelationship("org-1", "resident-1", { ...actor })).rejects.toMatchObject({
      code: "HOA_RELATIONSHIP_ALREADY_ENDED",
    });
  });

  it("rejects a move-out date before the move-in date", async () => {
    findFirstPropertyResident.mockResolvedValueOnce({ id: "resident-1", status: "ACTIVE", moveInDate: new Date("2026-06-01") });
    const { endPropertyResidentRelationship } = await import("../properties");
    await expect(
      endPropertyResidentRelationship("org-1", "resident-1", { moveOutDate: new Date("2026-01-01"), ...actor })
    ).rejects.toMatchObject({ code: "HOA_VALIDATION_ERROR" });
  });

  it("ends the relationship and clears isPrimaryContact", async () => {
    findFirstPropertyResident.mockResolvedValueOnce({ id: "resident-1", status: "ACTIVE", moveInDate: null });
    updatePropertyResident.mockResolvedValueOnce({ id: "resident-1", status: "ENDED" });
    const { endPropertyResidentRelationship } = await import("../properties");
    await endPropertyResidentRelationship("org-1", "resident-1", { ...actor });
    expect(updatePropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "resident-1" }, data: expect.objectContaining({ status: "ENDED", isPrimaryContact: false }) })
    );
  });
});

describe("getPropertyResidentHistory / listActivePropertyResidents", () => {
  it("getPropertyResidentHistory throws HOA_PROPERTY_NOT_FOUND for a cross-tenant property id", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { getPropertyResidentHistory } = await import("../properties");
    await expect(getPropertyResidentHistory("org-1", "prop-other-org")).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });
  });

  it("listActivePropertyResidents scopes the query to ACTIVE status only", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "prop-1" });
    findManyPropertyResident.mockResolvedValueOnce([]);
    const { listActivePropertyResidents } = await import("../properties");
    await listActivePropertyResidents("org-1", "prop-1");
    expect(findManyPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ where: { propertyId: "prop-1", organizationId: "org-1", status: "ACTIVE" } })
    );
  });
});
