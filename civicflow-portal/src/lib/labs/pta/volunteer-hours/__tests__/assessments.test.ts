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

const isPtaVolunteerAssessmentPostingEnabled = vi.fn();
vi.mock("@/lib/env", () => ({ isPtaVolunteerAssessmentPostingEnabled: () => isPtaVolunteerAssessmentPostingEnabled() }));

const findFirstBatch = vi.fn();
const createBatch = vi.fn();
const findManyBatches = vi.fn();
const updateManyBatch = vi.fn();
const findManyHouseholds = vi.fn();
const updateLine = vi.fn();
const updateManyLine = vi.fn();
const findManyLines = vi.fn();
const countLines = vi.fn();
const updateManyLineInTx = vi.fn();
const createChargeInTx = vi.fn();

const txClient = {
  ptaVolunteerAssessmentBatch: { updateMany: (...a: unknown[]) => updateManyBatch(...a) },
  ptaVolunteerAssessmentLine: {
    findMany: (...a: unknown[]) => findManyLines(...a),
    // RV-9: the per-line write inside the charge-creation transaction is a
    // conditional updateMany (claim), not an unconditional update — see
    // postAssessmentBatch's own doc comment.
    updateMany: (...a: unknown[]) => updateManyLineInTx(...a),
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
      updateMany: (...a: unknown[]) => updateManyLine(...a),
      findMany: (...a: unknown[]) => findManyLines(...a),
      count: (...a: unknown[]) => countLines(...a),
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
  findManyLines.mockResolvedValue([]);
  countLines.mockResolvedValue(0);
  updateManyLine.mockResolvedValue({ count: 1 });
  updateManyLineInTx.mockResolvedValue({ count: 1 });
  // RV-11: on by default so every EXISTING postAssessmentBatch test keeps
  // testing what it was written to test; the kill-switch's own behavior is
  // covered by the dedicated describe block below.
  isPtaVolunteerAssessmentPostingEnabled.mockReturnValue(true);
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

  it("rejects a CANCELLED batch outright", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "CANCELLED" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  it("rejects a lost claim race on a still-DRAFT batch (a genuine simultaneous double-post)", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 0 }); // another concurrent call claimed it first
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("creates one charge per line whose freshly re-verified remaining hours are still > 0, skips EXCLUDED lines, and posts one idempotent ASSESSMENT_CHARGE ledger entry each", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: new Date("2027-01-15"), assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([
      { id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" },
      { id: "line-2", householdId: "hh-2", assessmentCents: 5_000, status: "INCLUDED" },
    ]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 900, eventMinutes: 900, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0,
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    }); // remaining = 300min = 5h -> 5 * $25 = $125 = 12,500 cents, for BOTH households (same mock)
    createChargeInTx
      .mockResolvedValueOnce({ id: "charge-1" })
      .mockResolvedValueOnce({ id: "charge-2" });
    countLines.mockResolvedValue(0); // both lines resolved -> nothing remains INCLUDED

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(result.charges).toHaveLength(2);
    expect(result.batchFullyPosted).toBe(true);
    expect(result.remainingLineCount).toBe(0);
    expect(createChargeInTx).toHaveBeenCalledTimes(2);
    expect(postLedgerEntry).toHaveBeenCalledTimes(2);
    expect(postLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entryType: "ASSESSMENT_CHARGE", amountCents: 12_500, sourceType: "assessmentLine", sourceId: "line-1" })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ chargeCount: 2, resumed: false, batchFullyPosted: true, remainingLineCount: 0 }) })
    );
  });

  it("findManyLines only ever queries INCLUDED lines — EXCLUDED lines never generate a charge", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([]);
    const { postAssessmentBatch } = await import("../assessments");
    await postAssessmentBatch("org-1", "batch-1", actor);
    expect(findManyLines).toHaveBeenCalledWith(expect.objectContaining({ where: { batchId: "batch-1", status: "INCLUDED" } }));
  });

  it("FC-7: rejects posting before the period's assessmentDate has been reached", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: new Date(Date.now() + 60_000) });
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VOLUNTEER_ASSESSMENT_NOT_YET_DUE" });
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  it("FC-7: allows posting once the assessmentDate instant has been reached (open-inclusive boundary)", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: new Date(Date.now() - 1) });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([]);
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).resolves.toEqual({ charges: [], batchFullyPosted: true, remainingLineCount: 0 });
  });

  it.each([
    ["null", null],
    ["far in the past", new Date("2000-01-01")],
    ["far in the future", new Date("2099-01-01")],
  ])(
    "RV-3: assessmentPaymentDueDate (%s) never affects posting -- assessmentDate alone gates it (docs/pta-volunteer-hours-date-semantics.md)",
    async (_label, assessmentPaymentDueDate) => {
      findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
      updateManyBatch.mockResolvedValue({ count: 0 });
      getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate, assessmentDate: new Date(Date.now() + 60_000) });
      const { postAssessmentBatch } = await import("../assessments");
      // Still blocked: an informational due date, however it's set, cannot
      // unblock (or block) a posting decision that assessmentDate governs.
      await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VOLUNTEER_ASSESSMENT_NOT_YET_DUE" });
      expect(updateManyBatch).not.toHaveBeenCalled();

      updateManyBatch.mockResolvedValue({ count: 1 });
      findManyLines.mockResolvedValue([]);
      getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate, assessmentDate: new Date(Date.now() - 1) });
      // Still allowed: the same due date value, however it's set, cannot
      // block a posting decision once assessmentDate has been reached.
      await expect(postAssessmentBatch("org-1", "batch-1", actor)).resolves.toEqual({ charges: [], batchFullyPosted: true, remainingLineCount: 0 });
    }
  );

  it("FC-7: auto-excludes (never charges) a line whose household fully satisfied its requirement since preview — re-verified fresh at post time, not the stale preview snapshot", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([{ id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 1200, eventMinutes: 1200, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0, // fully satisfied since preview
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    });
    countLines.mockResolvedValue(0);

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(result.charges).toHaveLength(0);
    expect(result.batchFullyPosted).toBe(true);
    expect(createChargeInTx).not.toHaveBeenCalled();
    expect(postLedgerEntry).not.toHaveBeenCalled();
    // RV-9: the auto-exclude write is a conditional updateMany (compare-and-swap
    // on the line's own INCLUDED status), not an unconditional update — see
    // postAssessmentBatch's own doc comment.
    expect(updateManyLine).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "line-1", status: "INCLUDED" }, data: expect.objectContaining({ status: "EXCLUDED", remainingMinutes: 0 }) })
    );
  });

  it("FC-7: charges the freshly re-verified amount, not the stale preview snapshot, when hours changed between preview and post", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" }); // rate stays locked from preview
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    // Preview snapshot said 5h remaining ($125 = 12,500 cents); by post time the
    // family did 3 more hours, leaving only 2h remaining ($50 = 5,000 cents).
    findManyLines.mockResolvedValue([{ id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 1080, eventMinutes: 1080, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0, // 18h verified -> 2h remaining
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    });
    createChargeInTx.mockResolvedValueOnce({ id: "charge-1" });
    countLines.mockResolvedValue(0);

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(result.charges).toEqual([{ id: "charge-1", householdId: "hh-1", amountCents: 5_000, lineId: "line-1" }]);
    expect(createChargeInTx).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amountCents: 5_000 }) }));
    // RV-9: the line is claimed (compare-and-swap) BEFORE the charge is
    // created, inside the same transaction.
    expect(updateManyLineInTx).toHaveBeenCalledWith({ where: { id: "line-1", status: "INCLUDED" }, data: expect.objectContaining({ status: "POSTED" }) });
  });

  it("FC-8: auto-excludes (never double-charges) a line that loses the database's duplicate-active-charge race, and still posts every OTHER household in the same batch", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([
      { id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" },
      { id: "line-2", householdId: "hh-2", assessmentCents: 5_000, status: "INCLUDED" },
    ]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 900, eventMinutes: 900, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0,
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    });

    const { Prisma } = await import("@prisma/client");
    const duplicateChargeError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: "PtaVolunteerAssessmentCharge_org_period_household_active" },
    });
    // hh-1's charge creation loses the DB race (another batch already holds
    // the active charge); hh-2's succeeds normally.
    createChargeInTx.mockRejectedValueOnce(duplicateChargeError).mockResolvedValueOnce({ id: "charge-2" });
    countLines.mockResolvedValue(0);

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(result.charges).toEqual([{ id: "charge-2", householdId: "hh-2", amountCents: 12_500, lineId: "line-2" }]);
    expect(updateManyLine).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "line-1", status: "INCLUDED" },
        data: expect.objectContaining({ status: "EXCLUDED", excludeReason: expect.stringContaining("already has an active assessment charge") }),
      })
    );
    expect(postLedgerEntry).toHaveBeenCalledTimes(1);
    expect(postLedgerEntry).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "line-2" }));
  });

  it("FC-8: rethrows an unrelated database error unchanged, rather than misclassifying it as a duplicate-charge race", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([{ id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 900, eventMinutes: 900, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0,
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    });
    createChargeInTx.mockRejectedValueOnce(new Error("connection reset"));

    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toThrow("connection reset");
  });
});

describe("postAssessmentBatch — RV-9 crash-safe resume", () => {
  it("resumes a batch already POSTED (a prior call's crash left it there) WITHOUT re-attempting the DRAFT->POSTED claim", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "POSTED" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    findManyLines.mockResolvedValue([{ id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 900, eventMinutes: 900, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0,
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    });
    createChargeInTx.mockResolvedValueOnce({ id: "charge-1" });
    countLines.mockResolvedValue(0);

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(updateManyBatch).not.toHaveBeenCalled(); // never re-claims an already-POSTED batch
    expect(result.charges).toHaveLength(1);
    expect(result.batchFullyPosted).toBe(true);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ resumed: true }) }));
  });

  it("a genuine no-op resume (already POSTED, zero remaining INCLUDED lines) returns idempotently without touching audit/notifications", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "POSTED" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    findManyLines.mockResolvedValue([]); // nothing left INCLUDED

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(result).toEqual({ charges: [], batchFullyPosted: true, remainingLineCount: 0 });
    expect(updateManyBatch).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
    expect(postLedgerEntry).not.toHaveBeenCalled();
  });

  it("reports batchFullyPosted: false when INCLUDED lines still remain after this call (e.g. this call itself was also interrupted)", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([{ id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 900, eventMinutes: 900, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0,
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    });
    createChargeInTx.mockResolvedValueOnce({ id: "charge-1" });
    // Simulate a household elsewhere in the batch that's STILL unresolved
    // by the time this call finishes (e.g. added mid-flight, or this call
    // was itself cut short) -- the count query is independent of what this
    // call itself processed.
    countLines.mockResolvedValue(3);

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(result.batchFullyPosted).toBe(false);
    expect(result.remainingLineCount).toBe(3);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ batchFullyPosted: false, remainingLineCount: 3 }) }));
  });

  it("a per-line claim lost to a concurrent resume (updateMany count 0) is skipped silently, never overwriting the winner's result", async () => {
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "POSTED" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    findManyLines.mockResolvedValue([{ id: "line-1", householdId: "hh-1", assessmentCents: 12_500, status: "INCLUDED" }]);
    resolveHouseholdRequirement.mockResolvedValue({ requiredMinutes: 1200, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false });
    getHouseholdLedgerTotals.mockResolvedValue({
      verifiedMinutes: 900, eventMinutes: 900, nonEventMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0,
      purchasedMinutes: 0, creditMinutes: 0, waivedMinutes: 0, assessmentChargeCents: 0,
      paidElectronicCents: 0, paidOfflineCents: 0, refundedCents: 0, writtenOffCents: 0, outstandingBalanceCents: 0,
    });
    // A concurrent resume call already claimed this exact line.
    updateManyLineInTx.mockResolvedValue({ count: 0 });
    countLines.mockResolvedValue(0);

    const { postAssessmentBatch } = await import("../assessments");
    const result = await postAssessmentBatch("org-1", "batch-1", actor);

    expect(result.charges).toHaveLength(0); // this caller created nothing -- the concurrent winner did
    expect(createChargeInTx).not.toHaveBeenCalled(); // never even attempted the charge once the line-claim lost
  });
});

describe("postAssessmentBatch — RV-11 assessment reversal remains a hard boundary", () => {
  it("blocks posting outright when the kill-switch is off, before even looking up the batch", async () => {
    isPtaVolunteerAssessmentPostingEnabled.mockReturnValue(false);
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VOLUNTEER_ASSESSMENT_POSTING_BLOCKED" });
    expect(findFirstBatch).not.toHaveBeenCalled();
    expect(updateManyBatch).not.toHaveBeenCalled();
  });

  it("blocks a RESUME attempt too, even on an already-POSTED batch with lines still remaining -- the switch gates every call, not just first-time claims", async () => {
    isPtaVolunteerAssessmentPostingEnabled.mockReturnValue(false);
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "POSTED" });
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).rejects.toMatchObject({ code: "PTA_VOLUNTEER_ASSESSMENT_POSTING_BLOCKED" });
  });

  it("allows posting normally once the kill-switch is on", async () => {
    isPtaVolunteerAssessmentPostingEnabled.mockReturnValue(true);
    findFirstBatch.mockResolvedValue({ requirementPeriodId: "period-1", rateCents: 2_500, status: "DRAFT" });
    getVolunteerRequirementPeriod.mockResolvedValue({ assessmentPaymentDueDate: null, assessmentDate: null });
    updateManyBatch.mockResolvedValue({ count: 1 });
    findManyLines.mockResolvedValue([]);
    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch("org-1", "batch-1", actor)).resolves.toEqual({ charges: [], batchFullyPosted: true, remainingLineCount: 0 });
  });

  it("never gates previewAssessmentBatch -- preview must remain available regardless of the posting kill-switch", async () => {
    isPtaVolunteerAssessmentPostingEnabled.mockReturnValue(false);
    findManyHouseholds.mockResolvedValue([]);
    resolveVolunteerBuyoutRate.mockResolvedValue({ id: "window-final", amountCents: 2_500 });
    createBatch.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "batch-1", ...data }));
    const { previewAssessmentBatch } = await import("../assessments");
    await expect(previewAssessmentBatch("org-1", "period-1", actor)).resolves.toBeTruthy();
    expect(isPtaVolunteerAssessmentPostingEnabled).not.toHaveBeenCalled();
  });

  it("never gates excludeAssessmentLine/includeAssessmentLine -- reviewing a still-DRAFT batch's lines is unaffected by the posting kill-switch", async () => {
    isPtaVolunteerAssessmentPostingEnabled.mockReturnValue(false);
    findFirstBatch.mockResolvedValue({ id: "batch-1", status: "DRAFT" });
    updateLine.mockResolvedValue({ id: "line-1", status: "EXCLUDED" });
    const { excludeAssessmentLine } = await import("../assessments");
    await expect(excludeAssessmentLine("org-1", "batch-1", "line-1", "family relocated", actor)).resolves.toBeTruthy();
  });

  it("never gates cancelAssessmentBatch -- an admin can still abandon a DRAFT batch regardless of the posting kill-switch", async () => {
    isPtaVolunteerAssessmentPostingEnabled.mockReturnValue(false);
    updateManyBatch.mockResolvedValue({ count: 1 });
    const { cancelAssessmentBatch } = await import("../assessments");
    await expect(cancelAssessmentBatch("org-1", "batch-1", actor)).resolves.toBeUndefined();
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.assessment_batch_cancelled" }));
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
