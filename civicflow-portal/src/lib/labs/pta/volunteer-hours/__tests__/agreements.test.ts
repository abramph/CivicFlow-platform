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
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        ptaVolunteerAgreementAcceptance: { create: (...a: unknown[]) => createAcceptance(...a) },
        ptaVolunteerRequirementPeriod: { update: (...a: unknown[]) => updatePeriod(...a) },
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
  agreementRequired: false,
  agreementVersionId: null as string | null,
  contractLinkedBuyoutEnabled: false,
  contractLinkedEligibilityDays: null as number | null,
  contractLinkedUsesAcceptanceRate: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  findFirstPeriod.mockResolvedValue(BASE_PERIOD);
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
