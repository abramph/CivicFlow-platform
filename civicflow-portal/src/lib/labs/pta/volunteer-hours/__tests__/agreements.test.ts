import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstVersion = vi.fn();
const findManyVersions = vi.fn();
const createVersion = vi.fn();
const updateVersion = vi.fn();
const findUniqueAcceptance = vi.fn();
const createAcceptance = vi.fn();
const findFirstPeriod = vi.fn();
const updatePeriod = vi.fn();
const findManyAssignments = vi.fn();
const findManyElections = vi.fn();
const findManyAcceptances = vi.fn();
const findUniqueHouseholdAdult = vi.fn();
const findUniqueUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerAgreementVersion: {
      findFirst: (...a: unknown[]) => findFirstVersion(...a),
      findMany: (...a: unknown[]) => findManyVersions(...a),
      create: (...a: unknown[]) => createVersion(...a),
      update: (...a: unknown[]) => updateVersion(...a),
    },
    ptaVolunteerAgreementAcceptance: {
      findUnique: (...a: unknown[]) => findUniqueAcceptance(...a),
      create: (...a: unknown[]) => createAcceptance(...a),
      findMany: (...a: unknown[]) => findManyAcceptances(...a),
    },
    ptaVolunteerRequirementPeriod: {
      findFirst: (...a: unknown[]) => findFirstPeriod(...a),
      update: (...a: unknown[]) => updatePeriod(...a),
    },
    ptaVolunteerRequirementAssignment: { findMany: (...a: unknown[]) => findManyAssignments(...a) },
    ptaVolunteerBuyoutElection: { findMany: (...a: unknown[]) => findManyElections(...a) },
    ptaHouseholdAdult: { findUnique: (...a: unknown[]) => findUniqueHouseholdAdult(...a) },
    user: { findUnique: (...a: unknown[]) => findUniqueUser(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        ptaVolunteerAgreementAcceptance: { create: (...a: unknown[]) => createAcceptance(...a) },
        ptaVolunteerRequirementPeriod: { update: (...a: unknown[]) => updatePeriod(...a) },
        ptaVolunteerAgreementVersion: { update: (...a: unknown[]) => updateVersion(...a) },
      }),
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const sendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/mail", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const BASE_PERIOD = {
  id: "period-1",
  organizationId: "org-1",
  name: "2026-2027 School Year",
  timezone: "America/Chicago",
  status: "ACTIVE" as const,
  agreementRequired: false,
  agreementVersionId: null as string | null,
  contractLinkedBuyoutEnabled: false,
  contractLinkedEligibilityDays: null as number | null,
  contractLinkedUsesAcceptanceRate: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  findFirstPeriod.mockResolvedValue(BASE_PERIOD);
  findUniqueHouseholdAdult.mockResolvedValue({ name: "Jane Doe", relationshipLabel: "Parent" });
});

describe("agreement versioning", () => {
  it("createAgreementDraft assigns versionNumber = max+1, defaults to 1 for the first version", async () => {
    findManyVersions.mockResolvedValueOnce([]); // used by listAgreementVersions? no -- findFirst for max
    findFirstVersion.mockResolvedValue(null); // no prior version -> versionNumber 1
    createVersion.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v1", ...data }));

    const { createAgreementDraft } = await import("../agreements");
    const draft = await createAgreementDraft("org-1", "period-1", { title: "Commitment", content: "Please volunteer." }, { userId: "u1" });

    expect(draft).toMatchObject({ versionNumber: 1, status: "DRAFT", title: "Commitment" });
    expect(createVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contentHash: expect.any(String) }) })
    );
  });

  it("createAgreementDraft increments from the highest existing versionNumber", async () => {
    findFirstVersion.mockResolvedValue({ versionNumber: 3 });
    createVersion.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v4", ...data }));

    const { createAgreementDraft } = await import("../agreements");
    const draft = await createAgreementDraft("org-1", "period-1", { title: "v4", content: "text" }, { userId: "u1" });
    expect(draft.versionNumber).toBe(4);
  });

  it("rejects empty title/content", async () => {
    const { createAgreementDraft } = await import("../agreements");
    await expect(createAgreementDraft("org-1", "period-1", { title: "  ", content: "x" }, { userId: "u1" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
    await expect(createAgreementDraft("org-1", "period-1", { title: "x", content: "  " }, { userId: "u1" })).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("updateAgreementDraft succeeds on a DRAFT and recomputes contentHash", async () => {
    findFirstVersion.mockResolvedValue({ id: "v1", organizationId: "org-1", status: "DRAFT" });
    updateVersion.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v1", ...data }));

    const { updateAgreementDraft } = await import("../agreements");
    const updated = await updateAgreementDraft("org-1", "v1", { title: "New title", content: "New content" }, { userId: "u1" });
    expect(updated.title).toBe("New title");
    expect(updateVersion).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentHash: expect.any(String) }) }));
  });

  it("updateAgreementDraft rejects editing a PUBLISHED version -- immutability is enforced here, not just hidden in the UI", async () => {
    findFirstVersion.mockResolvedValue({ id: "v1", organizationId: "org-1", status: "PUBLISHED" });
    const { updateAgreementDraft } = await import("../agreements");
    await expect(updateAgreementDraft("org-1", "v1", { title: "x", content: "y" }, { userId: "u1" })).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_AGREEMENT_NOT_DRAFT",
    });
    expect(updateVersion).not.toHaveBeenCalled();
  });

  it("publishAgreementVersion transitions DRAFT -> PUBLISHED and stamps publishedAt/publishedByUserId", async () => {
    findFirstVersion.mockResolvedValue({ id: "v1", organizationId: "org-1", status: "DRAFT", requirementPeriodId: "period-1", versionNumber: 1, contentHash: "h" });
    updateVersion.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "v1", status: "PUBLISHED", requirementPeriodId: "period-1", ...data }));

    const { publishAgreementVersion } = await import("../agreements");
    const published = await publishAgreementVersion("org-1", "v1", { userId: "u1" });
    expect(published.status).toBe("PUBLISHED");
    expect(updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PUBLISHED", publishedByUserId: "u1", publishedAt: expect.any(Date) }) })
    );
  });

  it("publishAgreementVersion rejects a non-DRAFT version", async () => {
    findFirstVersion.mockResolvedValue({ id: "v1", organizationId: "org-1", status: "PUBLISHED" });
    const { publishAgreementVersion } = await import("../agreements");
    await expect(publishAgreementVersion("org-1", "v1", { userId: "u1" })).rejects.toMatchObject({ code: "PTA_VOLUNTEER_AGREEMENT_NOT_DRAFT" });
  });

  it("archiveAgreementVersion transitions PUBLISHED -> ARCHIVED, rejects archiving a DRAFT, and is idempotent on an already-ARCHIVED version", async () => {
    findFirstVersion.mockResolvedValueOnce({ id: "v1", organizationId: "org-1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    updateVersion.mockResolvedValueOnce({ id: "v1", status: "ARCHIVED" });
    const { archiveAgreementVersion } = await import("../agreements");
    const archived = await archiveAgreementVersion("org-1", "v1", { userId: "u1" });
    expect(archived.status).toBe("ARCHIVED");

    findFirstVersion.mockResolvedValueOnce({ id: "v2", organizationId: "org-1", status: "DRAFT" });
    await expect(archiveAgreementVersion("org-1", "v2", { userId: "u1" })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });

    findFirstVersion.mockResolvedValueOnce({ id: "v3", organizationId: "org-1", status: "ARCHIVED" });
    const result = await archiveAgreementVersion("org-1", "v3", { userId: "u1" });
    expect(result.status).toBe("ARCHIVED");
    expect(updateVersion).toHaveBeenCalledTimes(1); // only the first (real) transition wrote anything
  });

  it("FA2 §5: refuses to archive the period's currently-required version without a replacement", async () => {
    findFirstVersion.mockResolvedValueOnce({ id: "v1", organizationId: "org-1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    findFirstPeriod.mockResolvedValueOnce({ ...BASE_PERIOD, agreementRequired: true, agreementVersionId: "v1" });

    const { archiveAgreementVersion } = await import("../agreements");
    await expect(archiveAgreementVersion("org-1", "v1", { userId: "u1" })).rejects.toMatchObject({
      code: "PTA_VOLUNTEER_AGREEMENT_ACTIVELY_REQUIRED",
    });
    expect(updateVersion).not.toHaveBeenCalled();
  });

  it("FA2 §5: archives the currently-required version AND atomically reassigns the period when a valid replacement is supplied", async () => {
    findFirstVersion.mockResolvedValueOnce({ id: "v1", organizationId: "org-1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    findFirstPeriod.mockResolvedValueOnce({ ...BASE_PERIOD, agreementRequired: true, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValueOnce({ id: "v2", organizationId: "org-1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    updateVersion.mockResolvedValueOnce({ id: "v1", status: "ARCHIVED", requirementPeriodId: "period-1" });
    updatePeriod.mockResolvedValueOnce({ id: "period-1", agreementVersionId: "v2" });

    const { archiveAgreementVersion } = await import("../agreements");
    const archived = await archiveAgreementVersion("org-1", "v1", { userId: "u1" }, "v2");
    expect(archived.status).toBe("ARCHIVED");
    expect(updatePeriod).toHaveBeenCalledWith({ where: { id: "period-1" }, data: { agreementVersionId: "v2" } });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pta.volunteer_hours.agreement_archived", metadata: expect.objectContaining({ replacementVersionId: "v2" }), tx: expect.anything() })
    );
  });

  it("FA2 §5: rejects a replacement that is a DRAFT or belongs to a different period", async () => {
    findFirstVersion.mockResolvedValueOnce({ id: "v1", organizationId: "org-1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    findFirstPeriod.mockResolvedValueOnce({ ...BASE_PERIOD, agreementRequired: true, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValueOnce({ id: "v2", organizationId: "org-1", status: "DRAFT", requirementPeriodId: "period-1" });

    const { archiveAgreementVersion } = await import("../agreements");
    await expect(archiveAgreementVersion("org-1", "v1", { userId: "u1" }, "v2")).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(updateVersion).not.toHaveBeenCalled();
  });

  it("FA2 §5: a version that is assigned but not currently required, or not the period's current assignment, archives without needing a replacement", async () => {
    findFirstVersion.mockResolvedValueOnce({ id: "v1", organizationId: "org-1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    findFirstPeriod.mockResolvedValueOnce({ ...BASE_PERIOD, agreementRequired: false, agreementVersionId: "v1" }); // assigned, but not required
    updateVersion.mockResolvedValueOnce({ id: "v1", status: "ARCHIVED", requirementPeriodId: "period-1" });

    const { archiveAgreementVersion } = await import("../agreements");
    const archived = await archiveAgreementVersion("org-1", "v1", { userId: "u1" });
    expect(archived.status).toBe("ARCHIVED");
    expect(updatePeriod).not.toHaveBeenCalled();
  });
});

describe("updateAgreementPolicy", () => {
  it("rejects agreementRequired=true without an assigned version", async () => {
    const { updateAgreementPolicy } = await import("../agreements");
    await expect(
      updateAgreementPolicy(
        "org-1",
        "period-1",
        { agreementRequired: true, agreementVersionId: null, contractLinkedBuyoutEnabled: false, contractLinkedEligibilityDays: null, contractLinkedUsesAcceptanceRate: true },
        { userId: "u1" }
      )
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects contractLinkedBuyoutEnabled=true without eligibility days", async () => {
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    const { updateAgreementPolicy } = await import("../agreements");
    await expect(
      updateAgreementPolicy(
        "org-1",
        "period-1",
        { agreementRequired: false, agreementVersionId: "v1", contractLinkedBuyoutEnabled: true, contractLinkedEligibilityDays: null, contractLinkedUsesAcceptanceRate: true },
        { userId: "u1" }
      )
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects assigning a DRAFT or a version belonging to a different period", async () => {
    const { updateAgreementPolicy } = await import("../agreements");

    findFirstVersion.mockResolvedValueOnce({ id: "v1", status: "DRAFT", requirementPeriodId: "period-1" });
    await expect(
      updateAgreementPolicy(
        "org-1",
        "period-1",
        { agreementRequired: true, agreementVersionId: "v1", contractLinkedBuyoutEnabled: false, contractLinkedEligibilityDays: null, contractLinkedUsesAcceptanceRate: true },
        { userId: "u1" }
      )
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });

    findFirstVersion.mockResolvedValueOnce({ id: "v2", status: "PUBLISHED", requirementPeriodId: "OTHER-PERIOD" });
    await expect(
      updateAgreementPolicy(
        "org-1",
        "period-1",
        { agreementRequired: true, agreementVersionId: "v2", contractLinkedBuyoutEnabled: false, contractLinkedEligibilityDays: null, contractLinkedUsesAcceptanceRate: true },
        { userId: "u1" }
      )
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("succeeds with a valid published, same-period version and writes an atomic audit event via the transaction", async () => {
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", requirementPeriodId: "period-1" });
    updatePeriod.mockResolvedValue({ id: "period-1", agreementRequired: true, agreementVersionId: "v1" });

    const { updateAgreementPolicy } = await import("../agreements");
    const result = await updateAgreementPolicy(
      "org-1",
      "period-1",
      { agreementRequired: true, agreementVersionId: "v1", contractLinkedBuyoutEnabled: true, contractLinkedEligibilityDays: 14, contractLinkedUsesAcceptanceRate: true },
      { userId: "u1" }
    );
    expect(result.agreementVersionId).toBe("v1");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.agreement_policy_updated", tx: expect.anything() }));
  });
});

describe("resolveHouseholdAgreementStatus", () => {
  it("returns required=false, no version, not eligible when the period has no assigned version", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementRequired: false, agreementVersionId: null });
    const { resolveHouseholdAgreementStatus } = await import("../agreements");
    const status = await resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1");
    expect(status).toMatchObject({ required: false, assignedVersion: null, acceptance: null, contractLinkedEligibleNow: false });
  });

  it("computes contractLinkedEligibleUntil = acceptedAt + eligibilityDays, and eligibleNow correctly on both sides of that boundary", async () => {
    findFirstPeriod.mockResolvedValue({
      ...BASE_PERIOD,
      agreementVersionId: "v1",
      contractLinkedBuyoutEnabled: true,
      contractLinkedEligibilityDays: 10,
    });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED" });
    const acceptedAt = new Date("2027-01-01T00:00:00Z");
    findUniqueAcceptance.mockResolvedValue({ id: "acc-1", acceptedAt });

    const { resolveHouseholdAgreementStatus } = await import("../agreements");

    const justBefore = new Date("2027-01-10T23:59:59.999Z");
    const before = await resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1", justBefore);
    expect(before.contractLinkedEligibleNow).toBe(true);
    expect(before.contractLinkedEligibleUntil?.toISOString()).toBe("2027-01-11T00:00:00.000Z");

    const exactBoundary = new Date("2027-01-11T00:00:00.000Z");
    const atBoundary = await resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1", exactBoundary);
    expect(atBoundary.contractLinkedEligibleNow).toBe(false); // exclusive at the boundary

    const after = await resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1", new Date("2027-01-11T00:00:01Z"));
    expect(after.contractLinkedEligibleNow).toBe(false);
  });

  it("never eligible when there's no acceptance at all, even if contract-linked buyout is enabled", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1", contractLinkedBuyoutEnabled: true, contractLinkedEligibilityDays: 10 });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED" });
    findUniqueAcceptance.mockResolvedValue(null);

    const { resolveHouseholdAgreementStatus } = await import("../agreements");
    const status = await resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1");
    expect(status.contractLinkedEligibleNow).toBe(false);
    expect(status.contractLinkedEligibleUntil).toBeNull();
  });

  describe("FA2 §5: a content-hash mismatch fails closed", () => {
    it("throws rather than returning a status when the acceptance's snapshotted hash no longer matches the assigned version's live hash", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
      findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-current" });
      findUniqueAcceptance.mockResolvedValue({ id: "acc-1", acceptedAt: new Date(), contentHashAtAcceptance: "hash-STALE-OR-TAMPERED" });

      const { resolveHouseholdAgreementStatus } = await import("../agreements");
      await expect(resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1")).rejects.toMatchObject({
        code: "PTA_VOLUNTEER_AGREEMENT_CONTENT_HASH_MISMATCH",
      });
    });

    it("resolves normally when the hashes match (the expected case for every real acceptance, since published content is immutable)", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
      findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
      findUniqueAcceptance.mockResolvedValue({ id: "acc-1", acceptedAt: new Date(), contentHashAtAcceptance: "hash-abc" });

      const { resolveHouseholdAgreementStatus } = await import("../agreements");
      await expect(resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1")).resolves.toMatchObject({
        acceptance: { id: "acc-1" },
      });
    });

    it("never even compares hashes when there's no acceptance at all -- nothing to mismatch", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
      findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
      findUniqueAcceptance.mockResolvedValue(null);

      const { resolveHouseholdAgreementStatus } = await import("../agreements");
      await expect(resolveHouseholdAgreementStatus("org-1", "period-1", "hh-1")).resolves.toMatchObject({ acceptance: null });
    });
  });
});

describe("acceptAgreement", () => {
  it("rejects when acknowledged is false", async () => {
    const { acceptAgreement } = await import("../agreements");
    await expect(
      acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: false }, { userId: "u1", adultId: "adult-1" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects when the period has no assigned version", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: null });
    const { acceptAgreement } = await import("../agreements");
    await expect(
      acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED" });
  });

  it("rejects when the assigned version is not (or no longer) PUBLISHED", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "ARCHIVED" });
    const { acceptAgreement } = await import("../agreements");
    await expect(
      acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_AGREEMENT_NOT_ASSIGNED" });
  });

  describe("FA2 §5: a period must be ACTIVE to receive a NEW acceptance", () => {
    it.each(["DRAFT", "CLOSED", "ARCHIVED"] as const)("rejects when the period's own status is %s, even with a valid assigned+published version", async (status) => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, status, agreementVersionId: "v1" });
      findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
      const { acceptAgreement } = await import("../agreements");
      await expect(
        acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
      ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_NOT_ACTIVE" });
      expect(createAcceptance).not.toHaveBeenCalled();
    });

    it("a client-supplied periodId cannot smuggle a new acceptance into a non-ACTIVE period -- checked before any version lookup even runs", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, status: "ARCHIVED", agreementVersionId: "v1" });
      const { acceptAgreement } = await import("../agreements");
      await expect(
        acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
      ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_PERIOD_NOT_ACTIVE" });
      expect(findFirstVersion).not.toHaveBeenCalled();
    });

    it("still allows acceptance for an ACTIVE period (regression guard for the check above)", async () => {
      findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, status: "ACTIVE", agreementVersionId: "v1" });
      findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
      findUniqueAcceptance.mockResolvedValue(null);
      createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));
      const { acceptAgreement } = await import("../agreements");
      await expect(
        acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
      ).resolves.toMatchObject({ id: "acc-1" });
    });
  });

  it("creates a real acceptance with a server-generated acceptedAt, never trusting a client-supplied timestamp (there's no such input at all)", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValue(null);
    createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));

    const before = Date.now();
    const { acceptAgreement } = await import("../agreements");
    const acceptance = await acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true, typedName: "Jane Doe" }, { userId: "u1", adultId: "adult-1" });
    const after = Date.now();

    expect(acceptance.contentHashAtAcceptance).toBe("hash-abc");
    expect(acceptance.acceptedByAdultId).toBe("adult-1");
    expect((acceptance.acceptedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect((acceptance.acceptedAt as Date).getTime()).toBeLessThanOrEqual(after);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.agreement_accepted", tx: expect.anything() }));
  });

  it("FA3 signer snapshot: permanently records the accepting adult's name/relationship on the acceptance row, not just a live FK", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValue(null);
    findUniqueHouseholdAdult.mockResolvedValue({ name: "Priya Patel", relationshipLabel: "Guardian" });
    createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));

    const { acceptAgreement } = await import("../agreements");
    const acceptance = await acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" });

    expect(findUniqueHouseholdAdult).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "adult-1" } }));
    expect(acceptance.signerDisplayNameAtAcceptance).toBe("Priya Patel");
    expect(acceptance.signerRelationshipAtAcceptance).toBe("Guardian");
    expect(findUniqueUser).not.toHaveBeenCalled(); // adult lookup succeeded -- no need for the fallback path
  });

  it("FA4 §2 signer snapshot fallback: falls back to the authenticated user's displayName, then email, when the household adult has no usable name", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValue(null);
    createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));

    // Adult record exists but has no name (blank/whitespace) and no relationship label.
    findUniqueHouseholdAdult.mockResolvedValue({ name: "   ", relationshipLabel: null });
    findUniqueUser.mockResolvedValueOnce({ displayName: "Jordan Lee", email: "jordan@example.com" });
    const { acceptAgreement } = await import("../agreements");
    const withDisplayName = await acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" });
    expect(withDisplayName.signerDisplayNameAtAcceptance).toBe("Jordan Lee");
    expect(withDisplayName.signerRelationshipAtAcceptance).toBeNull();

    // Fallback user has no displayName -- falls further back to email.
    findUniqueAcceptance.mockResolvedValue(null);
    findUniqueUser.mockResolvedValueOnce({ displayName: null, email: "no-name@example.com" });
    const withEmailOnly = await acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" });
    expect(withEmailOnly.signerDisplayNameAtAcceptance).toBe("no-name@example.com");
  });

  it("FA4 §2: fails the acceptance (does not fabricate a placeholder) when neither the adult's name nor the authenticated user's displayName/email resolve to anything usable", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValue(null);
    createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));

    // Adult lookup itself comes back null (defensive edge case) and the fallback user has no displayName/email either.
    findUniqueHouseholdAdult.mockResolvedValueOnce(null);
    findUniqueUser.mockResolvedValueOnce({ displayName: null, email: "" });
    const { acceptAgreement } = await import("../agreements");
    await expect(
      acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_AGREEMENT_SIGNER_UNRESOLVED" });
    expect(createAcceptance).not.toHaveBeenCalled(); // never reaches the transaction at all
  });

  it("FA4 §2: fails the acceptance when the adult's name AND the fallback user's displayName/email are all whitespace-only, not just empty", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValue(null);
    createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));

    findUniqueHouseholdAdult.mockResolvedValueOnce({ name: "   ", relationshipLabel: null });
    findUniqueUser.mockResolvedValueOnce({ displayName: "   ", email: "   " });
    const { acceptAgreement } = await import("../agreements");
    await expect(
      acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
    ).rejects.toMatchObject({ code: "PTA_VOLUNTEER_AGREEMENT_SIGNER_UNRESOLVED" });
    expect(createAcceptance).not.toHaveBeenCalled();
  });

  it("FA4 §2: a client cannot supply or override the signer display name -- it is never read from AcceptAgreementInput at all, only typedName (a separate, optional display field) is client-input", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValue(null);
    findUniqueHouseholdAdult.mockResolvedValue({ name: "Real Adult Name", relationshipLabel: "Parent" });
    createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));

    const { acceptAgreement } = await import("../agreements");
    const acceptance = await acceptAgreement(
      "org-1",
      "period-1",
      "hh-1",
      // @ts-expect-error -- intentionally smuggling an attacker-controlled field the input type doesn't declare
      { acknowledged: true, signerDisplayNameAtAcceptance: "Attacker-Supplied Name" },
      { userId: "u1", adultId: "adult-1" }
    );
    expect(acceptance.signerDisplayNameAtAcceptance).toBe("Real Adult Name"); // the server-resolved value, never the smuggled one
  });

  it("audit-failure rollback: if createAuditEvent throws inside the transaction, acceptAgreement rejects rather than returning a 'successful' acceptance -- the write and its audit event commit or fail together, never one without the other", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValue(null);
    createAcceptance.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "acc-1", ...data }));
    const auditFailure = new Error("audit sink unavailable");
    createAuditEvent.mockRejectedValueOnce(auditFailure);

    const { acceptAgreement } = await import("../agreements");
    await expect(
      acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" })
    ).rejects.toBe(auditFailure);
  });

  it("is idempotent: a repeated submission for the same household+version returns the EXISTING acceptance, never creating a duplicate", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    const existing = { id: "acc-existing", acceptedAt: new Date("2027-01-01T00:00:00Z") };
    findUniqueAcceptance.mockResolvedValue(existing);

    const { acceptAgreement } = await import("../agreements");
    const result = await acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" });
    expect(result).toBe(existing);
    expect(createAcceptance).not.toHaveBeenCalled();
  });

  it("a lost race on the unique constraint (P2002) returns the winner's row instead of throwing", async () => {
    findFirstPeriod.mockResolvedValue({ ...BASE_PERIOD, agreementVersionId: "v1" });
    findFirstVersion.mockResolvedValue({ id: "v1", status: "PUBLISHED", contentHash: "hash-abc" });
    findUniqueAcceptance.mockResolvedValueOnce(null); // pre-check: nothing yet
    const { Prisma } = await import("@prisma/client");
    const dup = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["organizationId", "householdId", "agreementVersionId"] },
    });
    createAcceptance.mockRejectedValueOnce(dup);
    const winner = { id: "acc-winner", acceptedAt: new Date() };
    findUniqueAcceptance.mockResolvedValueOnce(winner); // post-P2002 refetch

    const { acceptAgreement } = await import("../agreements");
    const result = await acceptAgreement("org-1", "period-1", "hh-1", { acknowledged: true }, { userId: "u1", adultId: "adult-1" });
    expect(result).toBe(winner);
  });
});

// FA3 §5: preview renders only (never sends); a real test-send is a
// separate, more strictly gated operation. These are service-layer unit
// tests -- the API-route-level gating (capability/permission/rate-limit/
// confirm-phrase) is covered by each route's own test file.
describe("previewAgreementNotification -- render-only, never sends", () => {
  beforeEach(() => {
    findFirstPeriod.mockResolvedValue(BASE_PERIOD);
  });

  it("returns rendered subject/text and never calls sendEmail", async () => {
    const { previewAgreementNotification } = await import("../agreements");
    const result = await previewAgreementNotification("org-1", "period-1", "AGREEMENT_AVAILABLE", { userId: "u1", userEmail: "officer@example.test" });

    expect(result.subject).toContain(BASE_PERIOD.name);
    expect(result.subject).not.toContain("[TEST]"); // that prefix belongs only to a real test-send
    expect(result.text).toContain("AGREEMENT_AVAILABLE");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("audits the preview as its own distinct action, with no recipient in the metadata (there isn't one)", async () => {
    const { previewAgreementNotification } = await import("../agreements");
    await previewAgreementNotification("org-1", "period-1", "CONTRACT_OFFER_EXPIRING", { userId: "u1", userEmail: "officer@example.test" });

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pta.volunteer_hours.agreement_notification_previewed",
        metadata: { notificationType: "CONTRACT_OFFER_EXPIRING" },
      })
    );
  });
});

describe("sendTestAgreementNotification -- the only function here that can actually send", () => {
  beforeEach(() => {
    findFirstPeriod.mockResolvedValue(BASE_PERIOD);
  });

  it("sends to exactly the caller-supplied address with a [TEST]-prefixed subject, and audits delivered:true on success", async () => {
    sendEmail.mockResolvedValueOnce(undefined);
    const { sendTestAgreementNotification } = await import("../agreements");
    await sendTestAgreementNotification("org-1", "period-1", "AGREEMENT_REMINDER", "officer-test@example.test", {
      userId: "u1",
      userEmail: "officer@example.test",
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "officer-test@example.test", subject: expect.stringContaining("[TEST]") })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pta.volunteer_hours.agreement_notification_test_sent",
        metadata: { notificationType: "AGREEMENT_REMINDER", testRecipientEmail: "officer-test@example.test", delivered: true },
      })
    );
  });

  it("rejects a blank/whitespace-only recipient without ever calling sendEmail", async () => {
    const { sendTestAgreementNotification } = await import("../agreements");
    await expect(
      sendTestAgreementNotification("org-1", "period-1", "AGREEMENT_AVAILABLE", "   ", { userId: "u1", userEmail: "officer@example.test" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("when sendEmail fails, re-throws the real error AND audits delivered:false -- the audit event never falsely claims a delivery that didn't happen", async () => {
    const sendFailure = new Error("SMTP provider unavailable");
    sendEmail.mockRejectedValueOnce(sendFailure);
    const { sendTestAgreementNotification } = await import("../agreements");

    await expect(
      sendTestAgreementNotification("org-1", "period-1", "AGREEMENT_AVAILABLE", "officer-test@example.test", {
        userId: "u1",
        userEmail: "officer@example.test",
      })
    ).rejects.toBe(sendFailure);

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "pta.volunteer_hours.agreement_notification_test_sent",
        metadata: { notificationType: "AGREEMENT_AVAILABLE", testRecipientEmail: "officer-test@example.test", delivered: false },
      })
    );
  });
});
