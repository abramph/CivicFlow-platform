import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database tenant-isolation and concurrency tests for the HOA
 * Property/PropertyResident foundation (PR #43) — deliberately NOT using a
 * mocked Prisma client, unlike properties.test.ts/guard.test.ts. Mocked
 * unit tests can only prove the code *calls* the right conditional
 * queries; they can't prove the partial unique indexes actually make two
 * simultaneous requests race-safe against real Postgres. Mirrors
 * volunteers-concurrency.integration.test.ts's structure and skip
 * convention.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting
 * vitest, e.g.:
 *   DATABASE_URL="postgresql://postgres@localhost:55432/civicflow_disposable" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/hoa/__tests__/property-resident-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("HOA Property/PropertyResident — real tenant isolation and concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgAId: string;
  let orgBId: string;
  let propertyAId: string;
  let propertyBId: string;
  let memberAId: string;
  let memberBId: string;
  let actorUserId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const orgA = await prisma.organization.create({ data: { slug: `hoa-concurrency-a-${Date.now()}`, name: "HOA Concurrency Test Org A", primaryVertical: "HOA" } });
    const orgB = await prisma.organization.create({ data: { slug: `hoa-concurrency-b-${Date.now()}`, name: "HOA Concurrency Test Org B", primaryVertical: "HOA" } });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const actor = await prisma.user.create({ data: { email: `hoa-concurrency-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;

    const propertyA = await prisma.property.create({ data: { organizationId: orgAId, addressLine1: "142 Oak Ridge Drive", propertyType: "SINGLE_FAMILY" } });
    const propertyB = await prisma.property.create({ data: { organizationId: orgBId, addressLine1: "88 Ridge Commons", propertyType: "CONDO_UNIT" } });
    propertyAId = propertyA.id;
    propertyBId = propertyB.id;

    const memberA = await prisma.orgMember.create({ data: { organizationId: orgAId, firstName: "Morgan", lastName: "Reyes" } });
    const memberB = await prisma.orgMember.create({ data: { organizationId: orgBId, firstName: "Dana", lastName: "Whitfield" } });
    memberAId = memberA.id;
    memberBId = memberB.id;
  });

  afterAll(async () => {
    // Property/PropertyResident.organizationId are onDelete: Restrict (by
    // design -- see the schema-drift warning on PropertyResident) so
    // deleting the organization directly would fail with a foreign-key
    // violation and (with the .catch(() => {}) below) silently leave
    // orphaned test data behind on every run. Delete the child rows first.
    await prisma?.propertyResident.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.property.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgAId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgBId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("cannot assign org B's member to org A's property (cross-tenant denial)", async () => {
    const { assignPropertyResident } = await import("../properties");
    await expect(
      assignPropertyResident({ organizationId: orgAId, propertyId: propertyAId, orgMemberId: memberBId, relationshipType: "OWNER", actorUserId })
    ).rejects.toMatchObject({ code: "HOA_CROSS_TENANT_DENIED" });
  });

  it("cannot resolve org B's property through org A's organizationId (getProperty/getHoaPropertyAccessContext both fail closed)", async () => {
    const { getProperty } = await import("../properties");
    await expect(getProperty(orgAId, propertyBId)).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });

    const { getHoaPropertyAccessContext } = await import("../guard");
    await expect(getHoaPropertyAccessContext(orgAId, propertyBId, "ORG_ADMIN")).rejects.toMatchObject({ code: "HOA_PROPERTY_NOT_FOUND" });
  });

  it("real concurrency: exactly one of 8 simultaneous assignments for the same (property, member) pair succeeds", async () => {
    const { assignPropertyResident } = await import("../properties");

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        assignPropertyResident({ organizationId: orgAId, propertyId: propertyAId, orgMemberId: memberAId, relationshipType: "OWNER", actorUserId })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(7);
    for (const failure of failed) {
      if (failure.status === "rejected") {
        expect(failure.reason).toMatchObject({ code: "HOA_DUPLICATE_ACTIVE_RELATIONSHIP" });
      }
    }

    // The database itself must agree -- exactly one ACTIVE row, proving the
    // partial unique index (not just the returned promises) stayed
    // consistent under real concurrent load.
    const activeCount = await prisma.propertyResident.count({ where: { propertyId: propertyAId, orgMemberId: memberAId, status: "ACTIVE" } });
    expect(activeCount).toBe(1);

    // Clean up so the next test starts from a known state.
    await prisma.propertyResident.deleteMany({ where: { propertyId: propertyAId, orgMemberId: memberAId } });
  });

  it("real concurrency: exactly one of 6 simultaneous primary-contact assignments to distinct members on the same property wins", async () => {
    const { assignPropertyResident } = await import("../properties");

    const raceMembers = await Promise.all(
      Array.from({ length: 6 }, (_, i) => prisma.orgMember.create({ data: { organizationId: orgAId, firstName: "Race", lastName: `Member ${i}` } }))
    );

    const results = await Promise.allSettled(
      raceMembers.map((member: { id: string }) =>
        assignPropertyResident({
          organizationId: orgAId,
          propertyId: propertyAId,
          orgMemberId: member.id,
          relationshipType: "RESIDENT",
          isPrimaryContact: true,
          actorUserId,
        })
      )
    );

    // Every relationship itself succeeds (they're 6 distinct members, so the
    // "one active relationship per property+member" constraint doesn't
    // apply here) -- what's raced is the primary-contact flag specifically.
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const primaryContactCount = await prisma.propertyResident.count({
      where: { propertyId: propertyAId, status: "ACTIVE", isPrimaryContact: true },
    });
    expect(primaryContactCount).toBe(1);

    await prisma.propertyResident.deleteMany({ where: { propertyId: propertyAId, orgMemberId: { in: raceMembers.map((m: { id: string }) => m.id) } } });
  });
});
