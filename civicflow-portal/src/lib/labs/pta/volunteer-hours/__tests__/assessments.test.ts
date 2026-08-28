import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveHouseholdRequirement = vi.fn();
vi.mock("../assignments", () => ({ resolveHouseholdRequirement: (...a: unknown[]) => resolveHouseholdRequirement(...a) }));

const getHouseholdLedgerTotals = vi.fn();
const postLedgerEntry = vi.fn().mockResolvedValue({ id: "ledger-1" });
vi.mock("../ledger", () => ({
  getHouseholdLedgerTotals: (...a: unknown[]) => getHouseholdLedgerTotals(...a),
  postLedgerEntry: (...a: unknown[]) => postLedgerEntry(...a),
}));

const getVolunteerRequirementPeriod = vi.fn();
vi.mock("../periods", () => ({ getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a) }));

const resolveVolunteerBuyoutRate = vi.fn();
vi.mock("../pricing", () => ({ resolveVolunteerBuyoutRate: (...a: unknown[]) => resolveVolunteerBuyoutRate(...a) }));

const findFirstBatch = vi.fn();
const createBatch = vi.fn();
const findManyBatches = vi.fn();
const updateManyBatch = vi.fn();
const findManyHouseholds = vi.fn();
const updateLine = vi.fn();
const findManyLines = vi.fn();
const updateLineInTx = vi.fn();
const createChargeInTx = vi.fn();

const txClient = {
  ptaVolunteerAssessmentBatch: { updateMany: (...a: unknown[]) => updateManyBatch(...a) },
  ptaVolunteerAssessmentLine: {
    findMany: (...a: unknown[]) => findManyLines(...a),
    update: (...a: unknown[]) => updateLineInTx(...a),
  },
  ptaVolunteerAssessmentCharge: { create: (...a: unknown[]) => createChargeInTx(...a) },
};
const transactionMock = vi.fn(async (fn: (tx: typeof txClient) => unknown) => fn(txClient));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...a: Parameters<typeof transactionMock>) => transactionMock(...a),
    ptaVolunteerAssessmentBatch: {
      findFirst: (...a: unknown[]) => findFirstBatch(...a),
      create: (...a: unknown[]) => createBatch(...a),
      findMany: (...a: unknown[]) => findManyBatches(...a),
      updateMany: (...a: unknown[]) => updateManyBatch(...a),
    },
    ptaVolunteerAssessmentLine: {
      update: (...a: unknown[]) => updateLine(...a),
      findMany: (...a: unknown[]) => findManyLines(...a),
    },
    ptaHousehold: { findMany: (...a: unknown[]) => findManyHouseholds(...a) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (fn: (tx: typeof txClient) => unknown) => fn(txClient));
  findFirstBatch.mockResolvedValue(null);
});

const actor = { userId: "officer-1" };

describe("previewAssessmentBatch — acceptance scenario (end-of-period assessment)", () => {
  it("required 20h, verified 12h, purchased 3h, waived 0h -> remaining 5h x $25/hr = $125", async () => {
    findManyHouseholds.mockResolvedValue([{ id: "hh-1", displayName: "The Smiths" }]);
    resolveHouseholdRequirement.mockResolvedValue({
      requiredMinutes: 1200,
      assignmentType: "STANDARD",
      matchedScopeType: null,
      assignmentId: null,
      reason: null,
      exempt: false,
    });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 720,
      eventMinutes: 0,
      nonEventMinutes: 720,
      pendingMinutes: 0,
      rejectedMinutes: 0,
      purchasedMinutes: 180,
      creditMinutes: 0,
      waivedMinutes: 0,
      assessmentChargeCents: 0,
      paidElectronicCents: 0,
      paidOfflineCents: 0,
      refundedCents: 0,
      writtenOffCents: 0,
      outstandingBalanceCents: 0,
    });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-final", amountCents: 2_500 });
    createBatch.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "batch-1", ...data }));

    const { previewAssessmentBatch } = await import("../assessments");
    await previewAssessmentBatch("org-1", "period-1", actor);

    expect(createBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rateCents: 2_500,
          lines: {
            create: [
              expect.objectContaining({
                householdId: "hh-1",
                adjustedRequiredMinutes: 1200,
                verifiedMinutes: 720,
                purchasedMinutes: 180,
                remainingMinutes: 300, // 20h - 12h - 3h = 5h = 300min
                assessmentCents: 12_500, // 5h * $25
              }),
            ],
          },
        }),
      })
    );
  });

  it("skips exempt households entirely", async () => {
    findManyHouseholds.mockResolvedValue([{ id: "hh-1", displayName: "Exempt Family" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 0, assignmentType: "EXEMPT_FULL", matchedScopeType: "HOUSEHOLD", assignmentId: "a1", reason: "hardship", exempt: true });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-final", amountCents: 2_500 });
    createBatch.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "batch-1", ...data }));

    const { previewAssessmentBatch } = await import("../assessments");
    await previewAssessmentBatch("org-1", "period-1", actor);

    expect(getHouseholdLedgerTotals).not.toHaveBeenCalled();
    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lines: { create: [] } }) }));
  });

  it("skips households with zero or negative remaining minutes — nothing to assess", async () => {
    findManyHouseholds.mockResolvedValue([{ id: "hh-1", displayName: "Fully Compliant" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 1200,
      eventMinutes: 1200,
      nonEventMinutes: 0,
      pendingMinutes: 0,
      rejectedMinutes: 0,
      purchasedMinutes: 0,
      creditMinutes: 0,
      waivedMinutes: 0,
      assessmentChargeCents: 0,
      paidElectronicCents: 0,
      paidOfflineCents: 0,
      refundedCents: 0,
      writtenOffCents: 0,
      outstandingBalanceCents: 0,
    });
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-final", amountCents: 2_500 });
    createBatch.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "batch-1", ...data }));

    const { previewAssessmentBatch } = await import("../assessments");
    await previewAssessmentBatch("org-1", "period-1", actor);

    expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lines: { create: [] } }) }));
  });

  it("rejects preview when no FINAL_ASSESSMENT rate is configured", async () => {
    resolveVolunteerBuyoutRate.mockResolvedValue(null);
    const { previewAssessmentBatch } = await import("../assessments");
    await expect(previewAssessmentBatch("org-1", "period-1", actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("reuses an existing DRAFT batch instead of creating a duplicate", async () => {
    findFirstBatch.mockResolvedValue({ id: "existing-draft", status: "DRAFT", lines: [] });
    const { previewAssessmentBatch } = await import("../assessments");
    const result = await previewAssessmentBatch("org-1", "period-1", actor);
    expect(result).toMatchObject({ id: "existing-draft" });
    expect(createBatch).not.toHaveBeenCalled();
    expect(resolveVolunteerBuyoutRate).not.toHaveBeenCalled();
  });
});

describe("excludeAssessmentLine / includeAssessmentLine", () => {
  it("requires a reason to exclude a family", async () => {
    findFirstBatch.mockResolvedValue({ id: "batch-1", status: "DRAFT" });
    const { excludeAssessmentLine } = await import("../assessments");
    await expect(excludeAssessmentLine("org-1", "batch-1", "line-1", "  ", actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(updateLine).not.toHaveBeenCalled();
  });

  it("refuses to change lines on a non-DRAFT batch", async () => {
    findFirstBatch.mockResolvedValue({ id: "batch-1", status: "POSTED" });
    const { excludeAssessmentLine } = await import("../assessments");
    await expect(excludeAssessmentLine("org-1", "batch-1", "line-1", "family moved", actor)).rejects.toMatchObject({
      code: "PTA_VALIDATION_ERROR",
    });
  });

  it("excludes with a reason and writes an audit event", async () => {
    findFirstBatch.mockResolvedValue({ id: "batch-1", status: "DRAFT" });
    updateLine.mockResolvedValue({ id: "line-1", status: "EXCLUDED" });
    const { excludeAssessmentLine } = await import("../assessments");
    await excludeAssessmentLine("org-1", "batch-1", "line-1", "family relocated mid-year", actor);
    expect(updateLine).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "EXCLUDED", excludeReason: "family relocated mid-year" }) })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.assessment_line_excluded" }));
  });
});

describe("postAssessmentBatch — duplicate-post prevention & atomic charge creation", () => {
  it("throws when the batch is not found", async () => {
    findFirstBatch.mockResolvedValue(null);
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("rejects posting a batch that isn't DRAFT (already posted or cancelled)", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null });
    updateManyBatch.mockResolvedValue({ count: 0 });
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("creates one charge per INCLUDED line, skips EXCLUDED lines, and posts one idempotent ASSESSMENT_CHARGE ledger entry each", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: new Date("2027-01-15") });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([
      { id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" },
      { id: "line-2", householdId: "hh-2", assessmentCents: 5_000, status: "INCLUDED" },
    ]);
    createChargeInTx
      .mockResolvedValueOnce({ id: "charge-1" })
      .mockResolvedValueOnce({ id: "charge-2" });

    const { postAssessmentBatch } = await import("../assessments");
    const charges = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(charges).toHaveLength(2);
    expect(createChargeInTx).toHaveBeenCalledTimes(2);
    expect(postLedgerEntry).toHaveBeenCalledTimes(2);
    expect(postLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entryType: "ASSESSMENT_CHARGE", amountCents: 12_500, sourceType: "assessmentLine", sourceId: "line-1" })
    );
  });

  it("findManyLines only ever queries INCLUDED lines — EXCLUDED lines never generate a charge", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([]);
    const { postAssessmentBatch } = await import("../assessments");
    await postAssessmentBatch("org-1", "batch-1", actor);
    expect(findManyLines).toHaveBeenCalledWith(expect.objectContaining({ where: { batchId: "batch-1", status: "INCLUDED" } }));
  });
});

describe("cancelAssessmentBatch", () => {
  it("only cancels a DRAFT batch", async () => {
    updateManyBatch.mockResolvedValue({ count: 0 });
    const { cancelAssessmentBatch } = await import("../assessments");
    await expect(cancelAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("cancels successfully and writes an audit event", async () => {
    updateManyBatch.mockResolvedValue({ count: 1 });
    const { cancelAssessmentBatch } = await import("../assessments");
    await cancelAssessmentBatch("org-1", "batch-1", actor);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.assessment_batch_cancelled" }));
  });
});
