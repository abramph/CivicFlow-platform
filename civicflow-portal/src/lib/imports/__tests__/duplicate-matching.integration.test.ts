import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database test for the Resumable Import Program's duplicate-matching
 * hierarchy (PR B) — deliberately NOT using a mocked Prisma client, mirroring
 * the established convention in this codebase (e.g. PR A's
 * engine.integration.test.ts, whatsapp-conversation-sender.integration.test.ts).
 * The mocked unit tests (duplicate-matching.test.ts) can only prove the code
 * calls $queryRaw with the right template — they can't prove the phone
 * digit-normalization regex or the case-insensitive name lookup actually
 * work against real Postgres. The exact `\D` vs `\\D` regex bug that shipped
 * in the WhatsApp/SMS phone-matching code (only caught by a real-database
 * test, never by a mocked one) is precisely the class of bug this test
 * exists to catch here too.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/imports/__tests__/duplicate-matching.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("matchCommunityMemberRow — real Postgres", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;

  function normalizedRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      firstName: "Jane",
      lastName: "Doe",
      email: null,
      emailError: null,
      phone: null,
      addressLine1: null,
      city: null,
      state: null,
      zipCode: null,
      joinDate: null,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `duplicate-matching-${Date.now()}`, name: "Duplicate Matching Test Org", primaryVertical: "COMMUNITY" },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma?.orgMember.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("matches a stored E.164 phone number (with '+') against a differently-formatted incoming phone", async () => {
    const { matchCommunityMemberRow } = await import("../duplicate-matching");

    const member = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Regex", lastName: "Target", phone: "+12155550101" },
    });

    // The exact regression this test guards against: a broken '\D' (missing
    // the second backslash in the JS template literal) would silently never
    // strip the "+" or formatting characters, causing this comparison to
    // return zero rows even though the digits are identical.
    const result = await matchCommunityMemberRow(orgId, normalizedRow({ firstName: "Someone", lastName: "Else", phone: "(215) 555-0101" }));

    expect(result.status).toBe("POSSIBLE_DUPLICATE");
    expect(result.matchedRecordId).toBe(member.id);
    expect(result.matchConfidence).toBe(70);
  });

  it("does not use the phone tier when two different members share the same phone (ambiguous)", async () => {
    const { matchCommunityMemberRow } = await import("../duplicate-matching");

    await prisma.orgMember.create({ data: { organizationId: orgId, firstName: "Household", lastName: "MemberOne", phone: "+12155559999" } });
    await prisma.orgMember.create({ data: { organizationId: orgId, firstName: "Household", lastName: "MemberTwo", phone: "+12155559999" } });

    const result = await matchCommunityMemberRow(orgId, normalizedRow({ firstName: "New", lastName: "Person", phone: "215-555-9999" }));

    expect(result.status).toBe("NEW");
  });

  it("matches on name (case-insensitive) plus a corroborating address field", async () => {
    const { matchCommunityMemberRow } = await import("../duplicate-matching");

    const member = await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Alex", lastName: "Rivera", addressLine1: "123 Main St" },
    });

    const result = await matchCommunityMemberRow(orgId, normalizedRow({ firstName: "ALEX", lastName: "rivera", addressLine1: "123 Main St" }));

    expect(result.status).toBe("POSSIBLE_DUPLICATE");
    expect(result.matchedRecordId).toBe(member.id);
  });

  it("never matches on name alone — no corroborating field at all means NEW even with an identical name", async () => {
    const { matchCommunityMemberRow } = await import("../duplicate-matching");

    await prisma.orgMember.create({ data: { organizationId: orgId, firstName: "Common", lastName: "Name" } });

    const result = await matchCommunityMemberRow(orgId, normalizedRow({ firstName: "Common", lastName: "Name" }));

    expect(result.status).toBe("NEW");
  });

  it("email match with an identical existing record classifies as EXACT_DUPLICATE, not UPDATE_AVAILABLE", async () => {
    const { matchCommunityMemberRow } = await import("../duplicate-matching");

    await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Exact", lastName: "Match", email: "exact.match@example.test", city: "Philadelphia" },
    });

    const result = await matchCommunityMemberRow(
      orgId,
      normalizedRow({ firstName: "Exact", lastName: "Match", email: "exact.match@example.test", city: "Philadelphia" })
    );

    expect(result.status).toBe("EXACT_DUPLICATE");
  });

  it("email match with a genuinely differing field classifies as UPDATE_AVAILABLE", async () => {
    const { matchCommunityMemberRow } = await import("../duplicate-matching");

    await prisma.orgMember.create({
      data: { organizationId: orgId, firstName: "Update", lastName: "Available", email: "update.available@example.test", city: "Boston" },
    });

    const result = await matchCommunityMemberRow(
      orgId,
      normalizedRow({ firstName: "Update", lastName: "Available", email: "update.available@example.test", city: "Philadelphia" })
    );

    expect(result.status).toBe("UPDATE_AVAILABLE");
  });
});

describe.skipIf(!RUN_INTEGRATION)("matchPtaHouseholdRow / matchHoaPropertyRow — real Postgres (PR C)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let ptaOrgId: string;
  let hoaOrgId: string;

  function normalizedHouseholdRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      householdName: "The Doe Family",
      schoolYear: "2026-2027",
      contactName: "Jane Doe",
      contactEmail: "jane@example.test",
      contactEmailError: null,
      contactPhone: null,
      studentNames: [],
      notes: null,
      ...overrides,
    };
  }

  function normalizedPropertyRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      addressLine1: "123 Main St",
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
      unitLabel: null,
      buildingLabel: null,
      propertyType: null,
      ownerFirstName: null,
      ownerLastName: null,
      ownerEmail: null,
      ownerEmailError: null,
      relationshipType: null,
      notes: null,
      ...overrides,
    };
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const ptaOrg = await prisma.organization.create({
      data: { slug: `pta-import-matching-${Date.now()}`, name: "PTA Import Matching Test Org", primaryVertical: "PTA" },
    });
    ptaOrgId = ptaOrg.id;

    const hoaOrg = await prisma.organization.create({
      data: { slug: `hoa-import-matching-${Date.now()}`, name: "HOA Import Matching Test Org", primaryVertical: "HOA" },
    });
    hoaOrgId = hoaOrg.id;
  });

  afterAll(async () => {
    // PropertyResident's three FKs (organization/property/orgMember) are all
    // onDelete: Restrict, not Cascade — deleting property/orgMember before
    // their PropertyResident rows silently fails (caught below) and leaves
    // the whole org un-deletable. Must delete residents first.
    await prisma?.propertyResident.deleteMany({ where: { organizationId: hoaOrgId } }).catch(() => {});
    await prisma?.ptaHousehold.deleteMany({ where: { organizationId: ptaOrgId } }).catch(() => {});
    await prisma?.orgMember.deleteMany({ where: { organizationId: { in: [ptaOrgId, hoaOrgId] } } }).catch(() => {});
    await prisma?.property.deleteMany({ where: { organizationId: hoaOrgId } }).catch(() => {});
    await prisma?.organization.deleteMany({ where: { id: { in: [ptaOrgId, hoaOrgId] } } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("matches a household by the real (organizationId, displayName, schoolYear) unique key and distinguishes EXACT_DUPLICATE (has primary contact) from UPDATE_AVAILABLE (missing one)", async () => {
    const { matchPtaHouseholdRow } = await import("../duplicate-matching");

    const complete = await prisma.ptaHousehold.create({
      data: { organizationId: ptaOrgId, displayName: "Complete Family", schoolYear: "2026-2027" },
    });
    const adult = await prisma.ptaHouseholdAdult.create({
      data: { organizationId: ptaOrgId, householdId: complete.id, name: "Jane Doe", email: "jane@example.test" },
    });
    await prisma.ptaHousehold.update({ where: { id: complete.id }, data: { primaryContactAdultId: adult.id } });

    await prisma.ptaHousehold.create({
      data: { organizationId: ptaOrgId, displayName: "Partial Family", schoolYear: "2026-2027" },
    });

    const completeResult = await matchPtaHouseholdRow(ptaOrgId, normalizedHouseholdRow({ householdName: "Complete Family" }));
    expect(completeResult.status).toBe("EXACT_DUPLICATE");
    expect(completeResult.matchedRecordId).toBe(complete.id);

    const partialResult = await matchPtaHouseholdRow(ptaOrgId, normalizedHouseholdRow({ householdName: "Partial Family" }));
    expect(partialResult.status).toBe("UPDATE_AVAILABLE");

    const newResult = await matchPtaHouseholdRow(ptaOrgId, normalizedHouseholdRow({ householdName: "Never Seen Family" }));
    expect(newResult.status).toBe("NEW");
  });

  it("matches a property by the real (organizationId, addressLine1, unitLabel) tuple and distinguishes EXACT_DUPLICATE (owner already linked) from UPDATE_AVAILABLE (owner not yet linked)", async () => {
    const { matchHoaPropertyRow } = await import("../duplicate-matching");

    const property = await prisma.property.create({
      data: { organizationId: hoaOrgId, addressLine1: "456 Oak Ave", unitLabel: "2B" },
    });
    const owner = await prisma.orgMember.create({
      data: { organizationId: hoaOrgId, firstName: "Sam", lastName: "Owner", email: "sam.owner@example.test" },
    });

    const beforeLinking = await matchHoaPropertyRow(
      hoaOrgId,
      normalizedPropertyRow({ addressLine1: "456 Oak Ave", unitLabel: "2B", ownerFirstName: "Sam", ownerLastName: "Owner", ownerEmail: "sam.owner@example.test" })
    );
    expect(beforeLinking.status).toBe("UPDATE_AVAILABLE");

    await prisma.propertyResident.create({
      data: { organizationId: hoaOrgId, propertyId: property.id, orgMemberId: owner.id, relationshipType: "OWNER", isPrimaryContact: true, status: "ACTIVE" },
    });

    const afterLinking = await matchHoaPropertyRow(
      hoaOrgId,
      normalizedPropertyRow({ addressLine1: "456 Oak Ave", unitLabel: "2B", ownerFirstName: "Sam", ownerLastName: "Owner", ownerEmail: "sam.owner@example.test" })
    );
    expect(afterLinking.status).toBe("EXACT_DUPLICATE");
    expect(afterLinking.matchedRecordId).toBe(property.id);

    const differentUnit = await matchHoaPropertyRow(hoaOrgId, normalizedPropertyRow({ addressLine1: "456 Oak Ave", unitLabel: "3C" }));
    expect(differentUnit.status).toBe("NEW");
  });
});
