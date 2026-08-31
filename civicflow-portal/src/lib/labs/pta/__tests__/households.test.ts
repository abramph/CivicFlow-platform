import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHousehold = vi.fn();
const findManyHousehold = vi.fn();
const createHousehold = vi.fn();
const updateHousehold = vi.fn();
const deleteHousehold = vi.fn();
const createOrgMember = vi.fn();
const countDuesCharge = vi.fn();
const countAgreementAcceptance = vi.fn();
const countBuyoutElection = vi.fn();
const countBuyoutPurchase = vi.fn();
const countAssessmentCharge = vi.fn();
const countHourDispute = vi.fn();
const findFirstAdult = vi.fn();
const createAdult = vi.fn();
const updateHouseholdAdult = vi.fn();
const deleteAdult = vi.fn();
const findFirstStudent = vi.fn();
const createStudent = vi.fn();
const updateStudent = vi.fn();
const findUniqueOrgMember = vi.fn();
const updateOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHousehold: { findFirst: (...a: unknown[]) => findFirstHousehold(...a), findMany: (...a: unknown[]) => findManyHousehold(...a), create: (...a: unknown[]) => createHousehold(...a), update: (...a: unknown[]) => updateHousehold(...a), delete: (...a: unknown[]) => deleteHousehold(...a) },
    orgMember: { create: (...a: unknown[]) => createOrgMember(...a), findUnique: (...a: unknown[]) => findUniqueOrgMember(...a), update: (...a: unknown[]) => updateOrgMember(...a) },
    duesCharge: { count: (...a: unknown[]) => countDuesCharge(...a) },
    ptaVolunteerAgreementAcceptance: { count: (...a: unknown[]) => countAgreementAcceptance(...a) },
    ptaVolunteerBuyoutElection: { count: (...a: unknown[]) => countBuyoutElection(...a) },
    ptaVolunteerBuyoutPurchase: { count: (...a: unknown[]) => countBuyoutPurchase(...a) },
    ptaVolunteerAssessmentCharge: { count: (...a: unknown[]) => countAssessmentCharge(...a) },
    ptaVolunteerHourDispute: { count: (...a: unknown[]) => countHourDispute(...a) },
    ptaHouseholdAdult: { findFirst: (...a: unknown[]) => findFirstAdult(...a), create: (...a: unknown[]) => createAdult(...a), update: (...a: unknown[]) => updateHouseholdAdult(...a), delete: (...a: unknown[]) => deleteAdult(...a) },
    ptaStudent: { findFirst: (...a: unknown[]) => findFirstStudent(...a), create: (...a: unknown[]) => createStudent(...a), update: (...a: unknown[]) => updateStudent(...a) },
    // PTA-A dual-write: create paths resolve the schoolYearId FK twin of the label.
    ptaSchoolYear: { upsert: async () => ({ id: "school-year-mock" }) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("createPtaHousehold", () => {
  it("creates a billing-identity OrgMember and links it to the household", async () => {
    createOrgMember.mockResolvedValueOnce({ id: "member-1" });
    createHousehold.mockResolvedValueOnce({ id: "household-1", orgMemberId: "member-1" });

    const { createPtaHousehold } = await import("../households");
    const result = await createPtaHousehold({ organizationId: "org-a", displayName: "The Test Household", schoolYear: "2026-2027", actorUserId: "u1" });

    expect(createOrgMember).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", householdName: "The Test Household" }) }));
    expect(createHousehold).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orgMemberId: "member-1" }) }));
    expect(result.orgMemberId).toBe("member-1");
  });

  it("rejects an empty display name without ever touching the database", async () => {
    const { createPtaHousehold } = await import("../households");
    await expect(createPtaHousehold({ organizationId: "org-a", displayName: "   ", schoolYear: "2026-2027", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(createOrgMember).not.toHaveBeenCalled();
  });
});

describe("tenant isolation — cross-organization household access denied", () => {
  it("getPtaHousehold cannot read another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null); // simulates the real where-clause exclusion
    const { getPtaHousehold } = await import("../households");
    await expect(getPtaHousehold("org-b", "household-belonging-to-org-a")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(findFirstHousehold).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "household-belonging-to-org-a", organizationId: "org-b" } }));
  });

  it("updatePtaHousehold cannot update another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { updatePtaHousehold } = await import("../households");
    await expect(updatePtaHousehold({ organizationId: "org-b", householdId: "household-belonging-to-org-a", displayName: "Hijacked", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it("deactivatePtaHousehold cannot deactivate another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { deactivatePtaHousehold } = await import("../households");
    await expect(deactivatePtaHousehold("org-b", "household-belonging-to-org-a", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
  });

  it("addPtaHouseholdAdult cannot attach an adult to another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { addPtaHouseholdAdult } = await import("../households");
    await expect(addPtaHouseholdAdult({ organizationId: "org-b", householdId: "household-belonging-to-org-a", name: "Attacker", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(createAdult).not.toHaveBeenCalled();
  });

  it("addPtaStudent cannot attach a student to another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { addPtaStudent } = await import("../households");
    await expect(addPtaStudent({ organizationId: "org-b", householdId: "household-belonging-to-org-a", displayName: "Some Kid", actorUserId: "u1" })).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(createStudent).not.toHaveBeenCalled();
  });
});

describe("deletePtaHousehold — payment-history preservation", () => {
  it("refuses a hard delete once any DuesCharge exists, preserving financial history", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(2);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_PAYMENT_HISTORY" });
    expect(deleteHousehold).not.toHaveBeenCalled();
  });

  it("allows a hard delete when there is no dues or volunteer-hours history at all", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(0);
    countAgreementAcceptance.mockResolvedValueOnce(0);
    countBuyoutElection.mockResolvedValueOnce(0);
    countBuyoutPurchase.mockResolvedValueOnce(0);
    countAssessmentCharge.mockResolvedValueOnce(0);
    countHourDispute.mockResolvedValueOnce(0);
    deleteHousehold.mockResolvedValueOnce({ id: "household-1" });

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).resolves.toBeUndefined();
    expect(deleteHousehold).toHaveBeenCalledWith({ where: { id: "household-1" } });
  });

  // FA2 §7, hardened FA3 §1/§2: PtaVolunteerAgreementAcceptance.householdId
  // is now a database-level ON DELETE RESTRICT (the FA3 retention-hardening
  // migration moved it off Cascade), so this guard is defense in depth in
  // front of that DB constraint, not the only thing preventing the loss —
  // mirrors the DuesCharge guard immediately above.
  it("refuses a hard delete once any agreement acceptance exists, preserving that history", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(0);
    countAgreementAcceptance.mockResolvedValueOnce(1);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_AGREEMENT_HISTORY" });
    expect(deleteHousehold).not.toHaveBeenCalled();
  });

  it("checks agreement history even for a household with no orgMemberId (never had dues billing)", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: null });
    countAgreementAcceptance.mockResolvedValueOnce(1);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_AGREEMENT_HISTORY" });
    expect(countDuesCharge).not.toHaveBeenCalled(); // no orgMemberId -> dues check is skipped entirely
    expect(deleteHousehold).not.toHaveBeenCalled();
  });

  // FA3 §2: the same retention-hardening migration moved buyout election,
  // buyout purchase, assessment charge, and hour dispute householdId FKs to
  // RESTRICT too. One test per model, each isolating that single count so a
  // failure pinpoints exactly which history type is being checked.
  it("refuses a hard delete once any buyout election exists", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(0);
    countAgreementAcceptance.mockResolvedValueOnce(0);
    countBuyoutElection.mockResolvedValueOnce(1);
    countBuyoutPurchase.mockResolvedValueOnce(0);
    countAssessmentCharge.mockResolvedValueOnce(0);
    countHourDispute.mockResolvedValueOnce(0);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_VOLUNTEER_FINANCIAL_HISTORY" });
    expect(deleteHousehold).not.toHaveBeenCalled();
  });

  it("refuses a hard delete once any buyout purchase exists", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(0);
    countAgreementAcceptance.mockResolvedValueOnce(0);
    countBuyoutElection.mockResolvedValueOnce(0);
    countBuyoutPurchase.mockResolvedValueOnce(1);
    countAssessmentCharge.mockResolvedValueOnce(0);
    countHourDispute.mockResolvedValueOnce(0);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_VOLUNTEER_FINANCIAL_HISTORY" });
    expect(deleteHousehold).not.toHaveBeenCalled();
  });

  it("refuses a hard delete once any assessment charge exists", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(0);
    countAgreementAcceptance.mockResolvedValueOnce(0);
    countBuyoutElection.mockResolvedValueOnce(0);
    countBuyoutPurchase.mockResolvedValueOnce(0);
    countAssessmentCharge.mockResolvedValueOnce(1);
    countHourDispute.mockResolvedValueOnce(0);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_VOLUNTEER_FINANCIAL_HISTORY" });
    expect(deleteHousehold).not.toHaveBeenCalled();
  });

  it("refuses a hard delete once any hour dispute exists", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    countDuesCharge.mockResolvedValueOnce(0);
    countAgreementAcceptance.mockResolvedValueOnce(0);
    countBuyoutElection.mockResolvedValueOnce(0);
    countBuyoutPurchase.mockResolvedValueOnce(0);
    countAssessmentCharge.mockResolvedValueOnce(0);
    countHourDispute.mockResolvedValueOnce(1);

    const { deletePtaHousehold } = await import("../households");
    await expect(deletePtaHousehold("org-a", "household-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_HAS_VOLUNTEER_FINANCIAL_HISTORY" });
    expect(deleteHousehold).not.toHaveBeenCalled();
  });
});

describe("household status → billing OrgMember membershipStatus sync", () => {
  it("deactivatePtaHousehold flips the billing OrgMember's membershipStatus to inactive — the real gap that let a deactivated household's billing identity keep appearing on the base 'All active with email' / 'Delinquent members' / 'By category' selectors, which read OrgMember.membershipStatus directly (unlike PTA's own targeting rules, which correctly query PtaHousehold.status)", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1", status: "ACTIVE" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", status: "INACTIVE" });

    const { deactivatePtaHousehold } = await import("../households");
    await deactivatePtaHousehold("org-a", "household-1", "u1");

    expect(updateOrgMember).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { membershipStatus: "inactive" } });
  });

  it("does not crash deactivating a household with no billing OrgMember at all", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: null, status: "ACTIVE" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", status: "INACTIVE" });

    const { deactivatePtaHousehold } = await import("../households");
    await expect(deactivatePtaHousehold("org-a", "household-1", "u1")).resolves.toBeDefined();
    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it("updatePtaHousehold syncs membershipStatus only when status actually changes", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1", status: "ACTIVE" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", status: "PENDING" });

    const { updatePtaHousehold } = await import("../households");
    await updatePtaHousehold({ organizationId: "org-a", householdId: "household-1", status: "PENDING", actorUserId: "u1" });

    expect(updateOrgMember).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { membershipStatus: "pending" } });
  });

  it("updatePtaHousehold does not touch the billing OrgMember when status is unchanged", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1", status: "ACTIVE" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", displayName: "Renamed" });

    const { updatePtaHousehold } = await import("../households");
    await updatePtaHousehold({ organizationId: "org-a", householdId: "household-1", displayName: "Renamed", actorUserId: "u1" });

    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it("updatePtaHousehold does not touch the billing OrgMember when status is set to the same value it already had", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1", status: "ACTIVE" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", status: "ACTIVE" });

    const { updatePtaHousehold } = await import("../households");
    await updatePtaHousehold({ organizationId: "org-a", householdId: "household-1", status: "ACTIVE", actorUserId: "u1" });

    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it("reactivating a household (INACTIVE -> ACTIVE) restores membershipStatus to active", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1", status: "INACTIVE" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", status: "ACTIVE" });

    const { updatePtaHousehold } = await import("../households");
    await updatePtaHousehold({ organizationId: "org-a", householdId: "household-1", status: "ACTIVE", actorUserId: "u1" });

    expect(updateOrgMember).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { membershipStatus: "active" } });
  });
});

describe("resolvePtaHouseholdAdultUserIds — push-notification fallback for the billing OrgMember", () => {
  it("returns every linked adult's userId, filtering out adults with no linked login", async () => {
    findFirstHousehold.mockResolvedValueOnce({
      adults: [{ userId: "adult-user-1" }, { userId: null }, { userId: "adult-user-2" }],
    });
    const { resolvePtaHouseholdAdultUserIds } = await import("../households");
    const result = await resolvePtaHouseholdAdultUserIds("org-a", "member-1");

    expect(findFirstHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", orgMemberId: "member-1", status: "ACTIVE" } })
    );
    expect(result).toEqual(["adult-user-1", "adult-user-2"]);
  });

  it("returns an empty list when the OrgMember isn't a household billing identity at all", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { resolvePtaHouseholdAdultUserIds } = await import("../households");
    const result = await resolvePtaHouseholdAdultUserIds("org-a", "not-a-household-member");
    expect(result).toEqual([]);
  });

  it("returns an empty list for a deactivated household, even if it has linked adults", async () => {
    findFirstHousehold.mockResolvedValueOnce(null); // the ACTIVE-only where-clause excludes it
    const { resolvePtaHouseholdAdultUserIds } = await import("../households");
    const result = await resolvePtaHouseholdAdultUserIds("org-a", "member-1");
    expect(result).toEqual([]);
  });
});

describe("addPtaHouseholdAdult — billing-identity contact sync", () => {
  it("fills the OrgMember's empty email/phone when makePrimaryContact is set", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    createAdult.mockResolvedValueOnce({ id: "adult-1" });
    findUniqueOrgMember.mockResolvedValueOnce({ email: null, phone: null });

    const { addPtaHouseholdAdult } = await import("../households");
    await addPtaHouseholdAdult({
      organizationId: "org-a",
      householdId: "household-1",
      name: "Jordan Parent",
      email: "jordan@example.com",
      phone: "555-0100",
      makePrimaryContact: true,
      actorUserId: "u1",
    });

    expect(updateHousehold).toHaveBeenCalledWith({ where: { id: "household-1" }, data: { primaryContactAdultId: "adult-1" } });
    expect(updateOrgMember).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { email: "jordan@example.com", phone: "555-0100" } });
  });

  it("never overwrites an OrgMember email/phone that's already set — the real production bug this fixes", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    createAdult.mockResolvedValueOnce({ id: "adult-1" });
    // Simulates a household whose billing OrgMember already has a real (possibly
    // manually-edited via the general member-edit form) email/phone.
    findUniqueOrgMember.mockResolvedValueOnce({ email: "already-set@example.com", phone: "555-9999" });

    const { addPtaHouseholdAdult } = await import("../households");
    await addPtaHouseholdAdult({
      organizationId: "org-a",
      householdId: "household-1",
      name: "Jordan Parent",
      email: "jordan@example.com",
      phone: "555-0100",
      makePrimaryContact: true,
      actorUserId: "u1",
    });

    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it("does not touch the billing OrgMember at all when makePrimaryContact is not set — the real production gap this PR closes on the UI side", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    createAdult.mockResolvedValueOnce({ id: "adult-1" });

    const { addPtaHouseholdAdult } = await import("../households");
    await addPtaHouseholdAdult({ organizationId: "org-a", householdId: "household-1", name: "Jordan Parent", email: "jordan@example.com", actorUserId: "u1" });

    expect(updateHousehold).not.toHaveBeenCalled();
    expect(findUniqueOrgMember).not.toHaveBeenCalled();
    expect(updateOrgMember).not.toHaveBeenCalled();
  });
});

describe("setPtaHouseholdPrimaryContact — designating/reassigning a primary contact after household creation", () => {
  it("sets primaryContactAdultId and fills the OrgMember's empty email/phone from the adult", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-2", email: "second-adult@example.com", phone: "555-0200" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", primaryContactAdultId: "adult-2" });
    findUniqueOrgMember.mockResolvedValueOnce({ email: null, phone: null });

    const { setPtaHouseholdPrimaryContact } = await import("../households");
    const result = await setPtaHouseholdPrimaryContact("org-a", "household-1", "adult-2", "u1");

    expect(findFirstAdult).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "adult-2", householdId: "household-1", organizationId: "org-a" } }));
    expect(updateHousehold).toHaveBeenCalledWith({ where: { id: "household-1" }, data: { primaryContactAdultId: "adult-2" } });
    expect(updateOrgMember).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { email: "second-adult@example.com", phone: "555-0200" } });
    expect(result.primaryContactAdultId).toBe("adult-2");
  });

  it("never overwrites an OrgMember email/phone that's already set", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-2", email: "second-adult@example.com", phone: "555-0200" });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", primaryContactAdultId: "adult-2" });
    findUniqueOrgMember.mockResolvedValueOnce({ email: "already-on-file@example.com", phone: "555-9999" });

    const { setPtaHouseholdPrimaryContact } = await import("../households");
    await setPtaHouseholdPrimaryContact("org-a", "household-1", "adult-2", "u1");

    expect(updateOrgMember).not.toHaveBeenCalled();
  });

  it("rejects reassigning primary contact on another organization's household", async () => {
    findFirstHousehold.mockResolvedValueOnce(null);
    const { setPtaHouseholdPrimaryContact } = await import("../households");
    await expect(setPtaHouseholdPrimaryContact("org-b", "household-belonging-to-org-a", "adult-1", "u1")).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it("rejects an adult id that doesn't belong to this household/organization", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1" });
    findFirstAdult.mockResolvedValueOnce(null);
    const { setPtaHouseholdPrimaryContact } = await import("../households");
    await expect(setPtaHouseholdPrimaryContact("org-a", "household-1", "adult-from-elsewhere", "u1")).rejects.toMatchObject({ code: "PTA_NOT_A_HOUSEHOLD_MEMBER" });
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it("still works for an INACTIVE household — deliberately not blocked, so an officer can correct data on a household before archiving it", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: "member-1", status: "INACTIVE" });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", email: "parent@example.com", phone: null });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", primaryContactAdultId: "adult-1" });
    findUniqueOrgMember.mockResolvedValueOnce({ email: null, phone: null });

    const { setPtaHouseholdPrimaryContact } = await import("../households");
    await expect(setPtaHouseholdPrimaryContact("org-a", "household-1", "adult-1", "u1")).resolves.toMatchObject({ primaryContactAdultId: "adult-1" });
    expect(updateOrgMember).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { email: "parent@example.com" } });
  });

  it("sets primaryContactAdultId without touching any OrgMember when the household has no billing identity at all", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a", orgMemberId: null });
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", email: "parent@example.com", phone: null });
    updateHousehold.mockResolvedValueOnce({ id: "household-1", primaryContactAdultId: "adult-1" });

    const { setPtaHouseholdPrimaryContact } = await import("../households");
    await expect(setPtaHouseholdPrimaryContact("org-a", "household-1", "adult-1", "u1")).resolves.toMatchObject({ primaryContactAdultId: "adult-1" });
    expect(findUniqueOrgMember).not.toHaveBeenCalled();
    expect(updateOrgMember).not.toHaveBeenCalled();
  });
});

describe("resolvePtaHouseholdAdultUserIdsBatch — bulk campaign push fallback", () => {
  it("maps every requested billing OrgMember id to its household's linked adult userIds in one query", async () => {
    findManyHousehold.mockResolvedValueOnce([
      { orgMemberId: "member-1", adults: [{ userId: "adult-user-1" }, { userId: null }] },
      { orgMemberId: "member-2", adults: [{ userId: "adult-user-2" }, { userId: "adult-user-3" }] },
    ]);
    const { resolvePtaHouseholdAdultUserIdsBatch } = await import("../households");
    const result = await resolvePtaHouseholdAdultUserIdsBatch("org-a", ["member-1", "member-2", "member-3"]);

    expect(findManyHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", orgMemberId: { in: ["member-1", "member-2", "member-3"] }, status: "ACTIVE" } })
    );
    expect(result.get("member-1")).toEqual(["adult-user-1"]);
    expect(result.get("member-2")).toEqual(["adult-user-2", "adult-user-3"]);
    expect(result.has("member-3")).toBe(false); // no matching household came back — not in the result map at all
  });

  it("returns an empty map without querying at all when given no ids", async () => {
    const { resolvePtaHouseholdAdultUserIdsBatch } = await import("../households");
    const result = await resolvePtaHouseholdAdultUserIdsBatch("org-a", []);
    expect(result.size).toBe(0);
    expect(findManyHousehold).not.toHaveBeenCalled();
  });

  it("omits a household from the map entirely when none of its adults have a linked login", async () => {
    findManyHousehold.mockResolvedValueOnce([{ orgMemberId: "member-1", adults: [{ userId: null }] }]);
    const { resolvePtaHouseholdAdultUserIdsBatch } = await import("../households");
    const result = await resolvePtaHouseholdAdultUserIdsBatch("org-a", ["member-1"]);
    expect(result.has("member-1")).toBe(false);
  });
});

describe("addPtaStudent — data minimization", () => {
  it("audit metadata never includes the student's display name or any other field beyond stable identifiers", async () => {
    findFirstHousehold.mockResolvedValueOnce({ id: "household-1", organizationId: "org-a" });
    createStudent.mockResolvedValueOnce({ id: "student-1" });
    const { addPtaStudent } = await import("../households");
    await addPtaStudent({ organizationId: "org-a", householdId: "household-1", displayName: "Sensitive Kid Name", actorUserId: "u1" });

    const { createAuditEvent } = await import("@/lib/audit");
    const call = (createAuditEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[0] as { metadata: unknown; entityId: string };
    expect(call.entityId).toBe("student-1");
    expect(JSON.stringify(call.metadata)).not.toContain("Sensitive Kid Name");
  });
});
