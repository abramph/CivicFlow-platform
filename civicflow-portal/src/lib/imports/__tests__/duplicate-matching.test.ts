import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstOrgMember = vi.fn();
const findManyOrgMember = vi.fn();
const queryRawOrgMember = vi.fn();
const findFirstPtaHousehold = vi.fn();
const findManyPtaHousehold = vi.fn();
const findFirstProperty = vi.fn();
const findManyProperty = vi.fn();
const findFirstPropertyResident = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
      findMany: (...args: unknown[]) => findManyOrgMember(...args),
    },
    $queryRaw: (...args: unknown[]) => queryRawOrgMember(...args),
    ptaHousehold: {
      findFirst: (...args: unknown[]) => findFirstPtaHousehold(...args),
      findMany: (...args: unknown[]) => findManyPtaHousehold(...args),
    },
    property: {
      findFirst: (...args: unknown[]) => findFirstProperty(...args),
      findMany: (...args: unknown[]) => findManyProperty(...args),
    },
    propertyResident: {
      findFirst: (...args: unknown[]) => findFirstPropertyResident(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  findManyOrgMember.mockResolvedValue([]);
  queryRawOrgMember.mockResolvedValue([]);
});

function normalizedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
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

function existingMember(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "member-existing",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: null,
    addressLine1: null,
    city: null,
    state: null,
    zipCode: null,
    joinDate: null,
    ...overrides,
  };
}

describe("isExactMatch", () => {
  it("is true when every mapped incoming field is blank or identical to the existing record", async () => {
    const { isExactMatch } = await import("../duplicate-matching");
    expect(isExactMatch(normalizedRow(), existingMember())).toBe(true);
  });

  it("is true when the incoming row has blank fields the existing record has real data for (blank never counts as a conflict)", async () => {
    const { isExactMatch } = await import("../duplicate-matching");
    expect(isExactMatch(normalizedRow({ phone: null }), existingMember({ phone: "+12025550101" }))).toBe(true);
  });

  it("is false when a non-blank incoming field differs from the existing record", async () => {
    const { isExactMatch } = await import("../duplicate-matching");
    expect(isExactMatch(normalizedRow({ phone: "+12025550999" }), existingMember({ phone: "+12025550101" }))).toBe(false);
  });

  it("is case-insensitive on string comparisons", async () => {
    const { isExactMatch } = await import("../duplicate-matching");
    expect(isExactMatch(normalizedRow({ city: "Philadelphia" }), existingMember({ city: "philadelphia" }))).toBe(true);
  });
});

describe("matchCommunityMemberRow — tier 1: email", () => {
  it("returns EXACT_DUPLICATE when the email matches and every other field is identical or blank", async () => {
    findFirstOrgMember.mockResolvedValueOnce(existingMember());
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow());
    expect(result).toEqual({ status: "EXACT_DUPLICATE", matchedRecordId: "member-existing", matchConfidence: 100 });
  });

  it("returns UPDATE_AVAILABLE when the email matches but a field genuinely differs", async () => {
    findFirstOrgMember.mockResolvedValueOnce(existingMember({ phone: "+12025550101" }));
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow({ phone: "+12025550999" }));
    expect(result).toEqual({ status: "UPDATE_AVAILABLE", matchedRecordId: "member-existing", matchConfidence: 100 });
  });

  it("never falls through to phone/name tiers once an email match is found", async () => {
    findFirstOrgMember.mockResolvedValueOnce(existingMember());
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    await matchCommunityMemberRow("org-a", normalizedRow());
    expect(queryRawOrgMember).not.toHaveBeenCalled();
    expect(findManyOrgMember).not.toHaveBeenCalled();
  });
});

describe("matchCommunityMemberRow — tier 2: phone", () => {
  it("returns POSSIBLE_DUPLICATE on exactly one phone match when there's no email match", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    queryRawOrgMember.mockResolvedValueOnce([{ id: "member-phone-match" }]);
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow({ email: null, phone: "215-555-0101" }));
    expect(result).toEqual({ status: "POSSIBLE_DUPLICATE", matchedRecordId: "member-phone-match", matchConfidence: 70 });
  });

  it("does not use the phone tier when there are two or more ambiguous phone matches", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    queryRawOrgMember.mockResolvedValueOnce([{ id: "member-1" }, { id: "member-2" }]);
    findManyOrgMember.mockResolvedValueOnce([]);
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow({ email: null, phone: "215-555-0101" }));
    expect(result.status).toBe("NEW");
  });

  it("skips the phone tier entirely when the incoming phone doesn't normalize to a plausible number", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    findManyOrgMember.mockResolvedValueOnce([]);
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    await matchCommunityMemberRow("org-a", normalizedRow({ email: null, phone: "123" }));
    expect(queryRawOrgMember).not.toHaveBeenCalled();
  });
});

describe("matchCommunityMemberRow — tier 3: name + corroborating field", () => {
  it("returns POSSIBLE_DUPLICATE when name matches and phone also corroborates", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    findManyOrgMember.mockResolvedValueOnce([existingMember({ phone: "2155550101" })]);
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow({ email: null, phone: "(215) 555-0101" }));
    expect(result).toEqual({ status: "POSSIBLE_DUPLICATE", matchedRecordId: "member-existing", matchConfidence: 50 });
  });

  it("returns POSSIBLE_DUPLICATE when name matches and address also corroborates", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    findManyOrgMember.mockResolvedValueOnce([existingMember({ addressLine1: "123 Main St" })]);
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow({ email: null, addressLine1: "123 Main St" }));
    expect(result.status).toBe("POSSIBLE_DUPLICATE");
  });

  it("NEVER matches on name alone — no corroborating field means NEW, per the spec's explicit rule", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    findManyOrgMember.mockResolvedValueOnce([existingMember()]); // same name, but zero corroborating fields on either side
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow({ email: null }));
    expect(result.status).toBe("NEW");
  });

  it("scopes the name lookup to the organization and does case-insensitive matching", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    findManyOrgMember.mockResolvedValueOnce([]);
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    await matchCommunityMemberRow("org-a", normalizedRow({ email: null, firstName: "jane" }));
    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-a",
          firstName: { equals: "jane", mode: "insensitive" },
        }),
      })
    );
  });
});

describe("matchCommunityMemberRow — no match", () => {
  it("returns NEW with no matchedRecordId/matchConfidence when nothing matches at any tier", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);
    findManyOrgMember.mockResolvedValueOnce([]);
    const { matchCommunityMemberRow } = await import("../duplicate-matching");
    const result = await matchCommunityMemberRow("org-a", normalizedRow({ email: null }));
    expect(result).toEqual({ status: "NEW", matchedRecordId: null, matchConfidence: null });
  });
});

describe("computeFieldComparison", () => {
  it("marks a field as differing only when the incoming value is present and actually different", async () => {
    const { computeFieldComparison } = await import("../duplicate-matching");
    const result = computeFieldComparison(
      normalizedRow({ phone: "+12025550999", city: null }),
      existingMember({ phone: "+12025550101", city: "Philadelphia" })
    );
    const phoneField = result.find((f) => f.field === "phone")!;
    const cityField = result.find((f) => f.field === "city")!;
    expect(phoneField.differs).toBe(true);
    expect(cityField.differs).toBe(false); // blank incoming value never "differs"
    expect(cityField.currentValue).toBe("Philadelphia");
  });
});

// ─── PR C: PTA households ───────────────────────────────────────────────────

function normalizedHouseholdRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    householdName: "The Doe Family",
    schoolYear: "2026-2027",
    contactName: "Jane Doe",
    contactEmail: "jane@example.com",
    contactEmailError: null,
    contactPhone: null,
    studentNames: [],
    notes: null,
    ...overrides,
  };
}

describe("matchPtaHouseholdRow", () => {
  it("returns NEW when no household matches (organizationId, displayName, schoolYear)", async () => {
    findFirstPtaHousehold.mockResolvedValueOnce(null);
    const { matchPtaHouseholdRow } = await import("../duplicate-matching");
    const result = await matchPtaHouseholdRow("org-a", normalizedHouseholdRow());
    expect(result).toEqual({ status: "NEW", matchedRecordId: null, matchConfidence: null });
    expect(findFirstPtaHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", displayName: "The Doe Family", schoolYear: "2026-2027" } })
    );
  });

  it("returns EXACT_DUPLICATE when a matched household already has a primary contact", async () => {
    findFirstPtaHousehold.mockResolvedValueOnce({
      id: "household-1",
      displayName: "The Doe Family",
      schoolYear: "2026-2027",
      notes: null,
      primaryContactAdultId: "adult-1",
      adults: [{ id: "adult-1", name: "Jane Doe", email: "jane@example.com", phone: null }],
      students: [],
    });
    const { matchPtaHouseholdRow } = await import("../duplicate-matching");
    const result = await matchPtaHouseholdRow("org-a", normalizedHouseholdRow());
    expect(result).toEqual({ status: "EXACT_DUPLICATE", matchedRecordId: "household-1", matchConfidence: 100 });
  });

  it("returns UPDATE_AVAILABLE when a matched household is missing its primary contact (partial prior import)", async () => {
    findFirstPtaHousehold.mockResolvedValueOnce({
      id: "household-1",
      displayName: "The Doe Family",
      schoolYear: "2026-2027",
      notes: null,
      primaryContactAdultId: null,
      adults: [],
      students: [],
    });
    const { matchPtaHouseholdRow } = await import("../duplicate-matching");
    const result = await matchPtaHouseholdRow("org-a", normalizedHouseholdRow());
    expect(result).toEqual({ status: "UPDATE_AVAILABLE", matchedRecordId: "household-1", matchConfidence: 100 });
  });

  it("never produces POSSIBLE_DUPLICATE (deterministic DB-unique matching key, no fuzzy tier)", async () => {
    findFirstPtaHousehold.mockResolvedValueOnce(null);
    const { matchPtaHouseholdRow } = await import("../duplicate-matching");
    const result = await matchPtaHouseholdRow("org-a", normalizedHouseholdRow());
    expect(result.status).not.toBe("POSSIBLE_DUPLICATE");
  });
});

describe("computePtaHouseholdFieldComparison", () => {
  it("compares against the primary contact adult's fields, not the household row itself", async () => {
    const { computePtaHouseholdFieldComparison } = await import("../duplicate-matching");
    const result = computePtaHouseholdFieldComparison(normalizedHouseholdRow({ contactPhone: "215-555-0101" }), {
      id: "household-1",
      displayName: "The Doe Family",
      schoolYear: "2026-2027",
      notes: null,
      primaryContact: { name: "Jane Doe", email: "jane@example.com", phone: null },
      studentNames: [],
    });
    const phoneField = result.find((f) => f.field === "contactPhone")!;
    expect(phoneField.differs).toBe(true);
    expect(phoneField.currentValue).toBeNull();
  });

  it("surfaces new (not-yet-recorded) student names as a synthetic field without duplicating existing ones", async () => {
    const { computePtaHouseholdFieldComparison } = await import("../duplicate-matching");
    const result = computePtaHouseholdFieldComparison(normalizedHouseholdRow({ studentNames: ["Alex Doe", "Sam Doe"] }), {
      id: "household-1",
      displayName: "The Doe Family",
      schoolYear: "2026-2027",
      notes: null,
      primaryContact: { name: "Jane Doe", email: "jane@example.com", phone: null },
      studentNames: ["Alex Doe"],
    });
    const newStudentsField = result.find((f) => f.field === "newStudents")!;
    expect(newStudentsField.incomingValue).toBe("Sam Doe");
    expect(newStudentsField.differs).toBe(true);
  });
});

// ─── PR C: HOA properties ───────────────────────────────────────────────────

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

describe("matchHoaPropertyRow", () => {
  it("returns NEW when no property matches (organizationId, addressLine1, unitLabel)", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { matchHoaPropertyRow } = await import("../duplicate-matching");
    const result = await matchHoaPropertyRow("org-a", normalizedPropertyRow());
    expect(result).toEqual({ status: "NEW", matchedRecordId: null, matchConfidence: null });
  });

  it("returns EXACT_DUPLICATE when the property matches and no owner fields are mapped", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "property-1", addressLine1: "123 Main St", residents: [] });
    const { matchHoaPropertyRow } = await import("../duplicate-matching");
    const result = await matchHoaPropertyRow("org-a", normalizedPropertyRow());
    expect(result).toEqual({ status: "EXACT_DUPLICATE", matchedRecordId: "property-1", matchConfidence: 100 });
  });

  it("returns UPDATE_AVAILABLE when owner fields are present and not yet linked", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "property-1", addressLine1: "123 Main St", residents: [] });
    const { matchHoaPropertyRow } = await import("../duplicate-matching");
    const result = await matchHoaPropertyRow("org-a", normalizedPropertyRow({ ownerFirstName: "Sam", ownerLastName: "Owner", ownerEmail: "sam@example.com" }));
    expect(result).toEqual({ status: "UPDATE_AVAILABLE", matchedRecordId: "property-1", matchConfidence: 100 });
    expect(findFirstPropertyResident).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ propertyId: "property-1", status: "ACTIVE" }) })
    );
  });

  it("returns EXACT_DUPLICATE when the intended owner is already linked as an ACTIVE resident", async () => {
    findFirstProperty.mockResolvedValueOnce({ id: "property-1", addressLine1: "123 Main St", residents: [] });
    findFirstPropertyResident.mockResolvedValueOnce({ id: "resident-1" });
    const { matchHoaPropertyRow } = await import("../duplicate-matching");
    const result = await matchHoaPropertyRow("org-a", normalizedPropertyRow({ ownerFirstName: "Sam", ownerLastName: "Owner", ownerEmail: "sam@example.com" }));
    expect(result).toEqual({ status: "EXACT_DUPLICATE", matchedRecordId: "property-1", matchConfidence: 100 });
  });

  it("never produces POSSIBLE_DUPLICATE (deterministic application-level matching key, no fuzzy tier)", async () => {
    findFirstProperty.mockResolvedValueOnce(null);
    const { matchHoaPropertyRow } = await import("../duplicate-matching");
    const result = await matchHoaPropertyRow("org-a", normalizedPropertyRow());
    expect(result.status).not.toBe("POSSIBLE_DUPLICATE");
  });
});

describe("computeHoaPropertyFieldComparison", () => {
  it("compares owner fields against the currently linked ACTIVE resident, not the property row itself", async () => {
    const { computeHoaPropertyFieldComparison } = await import("../duplicate-matching");
    const result = computeHoaPropertyFieldComparison(normalizedPropertyRow({ ownerFirstName: "Sam", ownerLastName: "Owner" }), {
      id: "property-1",
      addressLine1: "123 Main St",
      addressLine2: null,
      city: null,
      state: null,
      zipCode: null,
      unitLabel: null,
      buildingLabel: null,
      propertyType: "SINGLE_FAMILY",
      notes: null,
      owner: null,
    });
    const ownerNameField = result.find((f) => f.field === "ownerName")!;
    expect(ownerNameField.differs).toBe(true);
    expect(ownerNameField.incomingValue).toBe("Sam Owner");
    expect(ownerNameField.currentValue).toBeNull();
  });

  it("never marks a blank incoming field as differing (blank-means-no-opinion, same rule as Community)", async () => {
    const { computeHoaPropertyFieldComparison } = await import("../duplicate-matching");
    const result = computeHoaPropertyFieldComparison(normalizedPropertyRow(), {
      id: "property-1",
      addressLine1: "123 Main St",
      addressLine2: "Suite 2",
      city: "Philadelphia",
      state: "PA",
      zipCode: "19103",
      unitLabel: null,
      buildingLabel: null,
      propertyType: "SINGLE_FAMILY",
      notes: null,
      owner: null,
    });
    expect(result.every((f) => !f.differs)).toBe(true);
  });
});
