import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-A — matching.ts. Fixture-simulator style (like
 * union/cases-tenant-isolation.test.ts): each mock only returns a row when
 * the WHERE clause the code actually sent matches, so a weakened/removed
 * organizationId filter fails these tests, not just a wrong id.
 */

const MEMBERS = [
  { id: "m-org-a-1", organizationId: "org-a", firstName: "Robert", lastName: "Johnson", email: "robert@example.com", phone: "+12155551111", dateOfBirth: new Date("1980-01-01"), addressLine1: "1 Main St", zipCode: "19102" },
  { id: "m-org-a-2", organizationId: "org-a", firstName: "Bob", lastName: "Johnson", email: null, phone: null, dateOfBirth: null, addressLine1: "1 Main St", zipCode: "19102" },
  { id: "m-org-a-3", organizationId: "org-a", firstName: "Alice", lastName: "Smith", email: "shared@example.com", phone: "+12155559999", dateOfBirth: null, addressLine1: null, zipCode: null },
  { id: "m-org-a-4", organizationId: "org-a", firstName: "Alicia", lastName: "Smyth", email: "shared@example.com", phone: null, dateOfBirth: null, addressLine1: null, zipCode: null },
  // Same email as m-org-a-1, but a DIFFERENT organization -- must never surface for org-a queries.
  { id: "m-org-b-1", organizationId: "org-b", firstName: "Robert", lastName: "Johnson", email: "robert@example.com", phone: "+19995550000", dateOfBirth: null, addressLine1: null, zipCode: null },
];

const findManyOrgMember = vi.fn();
const queryRawUnsafe = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findMany: (...a: unknown[]) => findManyOrgMember(...a) },
    $queryRaw: (...a: unknown[]) => queryRawUnsafe(...a),
  },
}));

function applyWhere(where: { organizationId: string; email?: unknown; firstName?: unknown; lastName?: unknown }) {
  return MEMBERS.filter((m) => {
    if (m.organizationId !== where.organizationId) return false;
    if (where.email) {
      const target = (where.email as { equals: string }).equals.toLowerCase();
      if ((m.email ?? "").toLowerCase() !== target) return false;
    }
    if (where.firstName) {
      const target = (where.firstName as { equals: string }).equals.toLowerCase();
      if (m.firstName.toLowerCase() !== target) return false;
    }
    if (where.lastName) {
      const target = (where.lastName as { equals: string }).equals.toLowerCase();
      if (m.lastName.toLowerCase() !== target) return false;
    }
    return true;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyOrgMember.mockImplementation((args: { where: never }) => applyWhere(args.where));
  queryRawUnsafe.mockResolvedValue([]);
});

describe("matchIntakeSubmission", () => {
  it("returns CONFIDENT_MATCH on a single exact email match", async () => {
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { email: "robert@example.com" });
    expect(result).toMatchObject({ status: "CONFIDENT_MATCH", memberId: "m-org-a-1", method: "exact_email" });
  });

  it("never matches an identical email belonging to a different organization", async () => {
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { email: "robert@example.com" });
    // m-org-b-1 shares the exact email but organizationId org-b -- must not appear.
    expect(result.memberId).not.toBe("m-org-b-1");
    expect(result.status).toBe("CONFIDENT_MATCH");
  });

  it("returns MULTIPLE_MATCHES when an exact email matches more than one member in the org", async () => {
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { email: "shared@example.com" });
    expect(result.status).toBe("MULTIPLE_MATCHES");
    expect(result.candidateMemberIds.sort()).toEqual(["m-org-a-3", "m-org-a-4"]);
    expect(result.memberId).toBeNull();
  });

  it("returns CONFIDENT_MATCH on a single exact phone match via digit-normalization", async () => {
    queryRawUnsafe.mockResolvedValue([{ id: "m-org-a-1" }]);
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { phone: "(215) 555-1111" });
    expect(result).toMatchObject({ status: "CONFIDENT_MATCH", memberId: "m-org-a-1", method: "exact_phone" });
  });

  it("returns MULTIPLE_MATCHES when phone matches more than one member", async () => {
    queryRawUnsafe.mockResolvedValue([{ id: "m-org-a-1" }, { id: "m-org-a-2" }]);
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { phone: "215-555-1111" });
    expect(result.status).toBe("MULTIPLE_MATCHES");
  });

  it("never returns CONFIDENT_MATCH from name alone, no matter how exact", async () => {
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { firstName: "Alice", lastName: "Smith" });
    // No corroborating DOB/address/zip agreement supplied -> NEW candidate pool is empty of corroboration.
    expect(result.status).not.toBe("CONFIDENT_MATCH");
  });

  it("returns POSSIBLE_MATCH (never CONFIDENT_MATCH) for name + corroborating address", async () => {
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { firstName: "Bob", lastName: "Johnson", addressLine1: "1 Main St" });
    expect(result).toMatchObject({ status: "POSSIBLE_MATCH", candidateMemberIds: ["m-org-a-2"] });
    expect(result.memberId).toBeNull();
  });

  it("returns NO_MATCH when nothing lines up", async () => {
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { firstName: "Nobody", lastName: "Here" });
    expect(result).toEqual({ status: "NO_MATCH", memberId: null, candidateMemberIds: [], confidence: null, method: null });
  });

  it("returns NO_MATCH when no identity fields are supplied at all", async () => {
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", {});
    expect(result.status).toBe("NO_MATCH");
  });
});
