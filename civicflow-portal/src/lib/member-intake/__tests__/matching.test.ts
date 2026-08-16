import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * MEMBER-QR-A/D — matching.ts. Fixture-simulator style (like
 * union/cases-tenant-isolation.test.ts): each mock only returns a row when
 * the WHERE clause the code actually sent matches, so a weakened/removed
 * organizationId (or, as of D, membershipStatus) filter fails these tests,
 * not just a wrong id.
 */

const MEMBERS = [
  { id: "m-org-a-1", organizationId: "org-a", firstName: "Robert", lastName: "Johnson", email: "robert@example.com", phone: "+12155551111", dateOfBirth: new Date("1980-01-01"), addressLine1: "1 Main St", zipCode: "19102", membershipStatus: "active" },
  { id: "m-org-a-2", organizationId: "org-a", firstName: "Bob", lastName: "Johnson", email: null, phone: null, dateOfBirth: null, addressLine1: "1 Main St", zipCode: "19102", membershipStatus: "active" },
  { id: "m-org-a-3", organizationId: "org-a", firstName: "Alice", lastName: "Smith", email: "shared@example.com", phone: "+12155559999", dateOfBirth: null, addressLine1: null, zipCode: null, membershipStatus: "active" },
  { id: "m-org-a-4", organizationId: "org-a", firstName: "Alicia", lastName: "Smyth", email: "shared@example.com", phone: null, dateOfBirth: null, addressLine1: null, zipCode: null, membershipStatus: "active" },
  // Same email as m-org-a-1, but a DIFFERENT organization -- must never surface for org-a queries.
  { id: "m-org-b-1", organizationId: "org-b", firstName: "Robert", lastName: "Johnson", email: "robert@example.com", phone: "+19995550000", dateOfBirth: null, addressLine1: null, zipCode: null, membershipStatus: "active" },
  // A terminated member -- must never be a CONFIDENT_MATCH target, regardless of how exact the signal is.
  { id: "m-org-a-terminated", organizationId: "org-a", firstName: "Former", lastName: "Member", email: "former@example.com", phone: "+12155550099", dateOfBirth: null, addressLine1: null, zipCode: null, membershipStatus: "terminated" },
  // Two distinct active members whose email/phone will be cross-submitted to test signal-contradiction handling.
  { id: "m-org-a-x", organizationId: "org-a", firstName: "X", lastName: "Person", email: "x@example.com", phone: "+12155550001", dateOfBirth: null, addressLine1: null, zipCode: null, membershipStatus: "active" },
  { id: "m-org-a-y", organizationId: "org-a", firstName: "Y", lastName: "Person", email: "y@example.com", phone: "+12155550002", dateOfBirth: null, addressLine1: null, zipCode: null, membershipStatus: "active" },
];

const findManyOrgMember = vi.fn();
const queryRawUnsafe = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findMany: (...a: unknown[]) => findManyOrgMember(...a) },
    $queryRaw: (...a: unknown[]) => queryRawUnsafe(...a),
  },
}));

function applyWhere(where: { organizationId: string; email?: unknown; firstName?: unknown; lastName?: unknown; membershipStatus?: { not: string } }) {
  return MEMBERS.filter((m) => {
    if (m.organizationId !== where.organizationId) return false;
    if (where.membershipStatus?.not && m.membershipStatus === where.membershipStatus.not) return false;
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

/** Simulates the raw-SQL phone query against the same fixture list + the
 * same terminated-exclusion rule the real query applies. */
function phoneQuery(organizationId: string, digits: string) {
  return MEMBERS.filter(
    (m) => m.organizationId === organizationId && m.membershipStatus !== "terminated" && m.phone && m.phone.replace(/\D/g, "") === digits
  ).map((m) => ({ id: m.id }));
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyOrgMember.mockImplementation((args: { where: never }) => applyWhere(args.where));
  queryRawUnsafe.mockImplementation(() => Promise.resolve([]));
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
    queryRawUnsafe.mockImplementation(() => Promise.resolve(phoneQuery("org-a", "12155551111")));
    const { matchIntakeSubmission } = await import("../matching");
    const result = await matchIntakeSubmission("org-a", { phone: "(215) 555-1111" });
    expect(result).toMatchObject({ status: "CONFIDENT_MATCH", memberId: "m-org-a-1", method: "exact_phone" });
  });

  it("returns MULTIPLE_MATCHES when phone matches more than one member", async () => {
    queryRawUnsafe.mockImplementation(() => Promise.resolve([{ id: "m-org-a-1" }, { id: "m-org-a-2" }]));
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

  describe("MEMBER-QR-D hardening", () => {
    it("never CONFIDENT_MATCHes a terminated member on an exact email match", async () => {
      const { matchIntakeSubmission } = await import("../matching");
      const result = await matchIntakeSubmission("org-a", { email: "former@example.com" });
      expect(result.status).toBe("NO_MATCH");
      expect(result.memberId).not.toBe("m-org-a-terminated");
    });

    it("never CONFIDENT_MATCHes a terminated member on an exact phone match", async () => {
      queryRawUnsafe.mockImplementation(() => Promise.resolve(phoneQuery("org-a", "12155550099")));
      const { matchIntakeSubmission } = await import("../matching");
      const result = await matchIntakeSubmission("org-a", { phone: "215-555-0099" });
      expect(result.status).toBe("NO_MATCH");
    });

    it("excludes a terminated member from name+corroboration matching too", async () => {
      const { matchIntakeSubmission } = await import("../matching");
      const result = await matchIntakeSubmission("org-a", { firstName: "Former", lastName: "Member", addressLine1: "anything" });
      expect(result.status).toBe("NO_MATCH");
    });

    it("CONFIDENT_MATCHes with combined method when email and phone agree on the same member", async () => {
      queryRawUnsafe.mockImplementation(() => Promise.resolve(phoneQuery("org-a", "12155550001")));
      const { matchIntakeSubmission } = await import("../matching");
      const result = await matchIntakeSubmission("org-a", { email: "x@example.com", phone: "215-555-0001" });
      expect(result).toMatchObject({ status: "CONFIDENT_MATCH", memberId: "m-org-a-x", method: "exact_email+exact_phone", confidence: 100 });
    });

    it("returns MULTIPLE_MATCHES (never picks one) when email and phone point to two different members", async () => {
      // Submits X's email but Y's phone -- a genuine contradiction.
      queryRawUnsafe.mockImplementation(() => Promise.resolve(phoneQuery("org-a", "12155550002")));
      const { matchIntakeSubmission } = await import("../matching");
      const result = await matchIntakeSubmission("org-a", { email: "x@example.com", phone: "215-555-0002" });
      expect(result.status).toBe("MULTIPLE_MATCHES");
      expect(result.method).toBe("conflicting_signals");
      expect(result.candidateMemberIds.sort()).toEqual(["m-org-a-x", "m-org-a-y"]);
      expect(result.memberId).toBeNull();
    });
  });
});
