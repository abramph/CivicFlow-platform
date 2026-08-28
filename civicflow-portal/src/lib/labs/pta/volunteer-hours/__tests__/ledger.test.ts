import { beforeEach, describe, expect, it, vi } from "vitest";

const createEntry = vi.fn();
const findFirstEntry = vi.fn();
const updateEntry = vi.fn();
const findManyEntries = vi.fn();
const findFirstPeriod = vi.fn();
const findUniqueOpportunity = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerLedgerEntry: {
      create: (...a: unknown[]) => createEntry(...a),
      findFirst: (...a: unknown[]) => findFirstEntry(...a),
      update: (...a: unknown[]) => updateEntry(...a),
      findMany: (...a: unknown[]) => findManyEntries(...a),
    },
    ptaVolunteerRequirementPeriod: { findFirst: (...a: unknown[]) => findFirstPeriod(...a) },
    ptaVolunteerOpportunity: { findUnique: (...a: unknown[]) => findUniqueOpportunity(...a) },
  },
}));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

beforeEach(() => {
  vi.clearAllMocks();
  // upsertHourEntryLedgerRow's "does a mirror row already exist for this
  // hour entry" lookup — default to "no" so every test not specifically
  // exercising the upsert-existing branch gets the plain create path,
  // matching this suite's pre-existing assumption. vi.clearAllMocks()
  // clears call history but NOT a previously-configured mockResolvedValue,
  // so this must be set explicitly every test, not just once at import time.
  findFirstEntry.mockResolvedValue(undefined);
});

const baseInput = {
  organizationId: "org-1",
  requirementPeriodId: "period-1",
  householdId: "hh-1",
  entryType: "SERVICE_VERIFIED" as const,
  minutes: 60,
};

describe("postLedgerEntry — idempotency", () => {
  it("creates a new row on first post", async () => {
    createEntry.mockResolvedValue({ id: "entry-1", ...baseInput });
    const { postLedgerEntry } = await import("../ledger");
    const result = await postLedgerEntry({ ...baseInput, sourceType: "hourEntry", sourceId: "he-1" });
    expect(result).toMatchObject({ id: "entry-1" });
    expect(createEntry).toHaveBeenCalledTimes(1);
  });

  it("on a P2002 duplicate-key error for a source-backed entry, returns the existing row instead of throwing", async () => {
    const p2002 = Object.assign(new Error("duplicate"), { code: "P2002" });
    createEntry.mockRejectedValueOnce(p2002);
    findFirstEntry.mockResolvedValue({ id: "entry-existing", ...baseInput });

    const { postLedgerEntry } = await import("../ledger");
    const result = await postLedgerEntry({ ...baseInput, sourceType: "hourEntry", sourceId: "he-1" });
    expect(result).toMatchObject({ id: "entry-existing" });
  });

  it("re-throws a P2002 for a manual entry with no sourceId (no idempotency safety net to fall back on)", async () => {
    const p2002 = Object.assign(new Error("duplicate"), { code: "P2002" });
    createEntry.mockRejectedValueOnce(p2002);
    const { postLedgerEntry } = await import("../ledger");
    await expect(postLedgerEntry({ ...baseInput, entryType: "ADMIN_CREDIT", reason: "correction" })).rejects.toThrow();
  });

  it("re-throws any non-P2002 error", async () => {
    createEntry.mockRejectedValueOnce(new Error("connection lost"));
    const { postLedgerEntry } = await import("../ledger");
    await expect(postLedgerEntry({ ...baseInput, sourceType: "hourEntry", sourceId: "he-1" })).rejects.toThrow("connection lost");
  });

  it.each(["ADMIN_CREDIT", "WAIVER", "WRITE_OFF", "CORRECTED"] as const)("requires a reason for %s entries", async (entryType) => {
    const { postLedgerEntry } = await import("../ledger");
    await expect(postLedgerEntry({ ...baseInput, entryType })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("does not require a reason for SERVICE_VERIFIED entries", async () => {
    createEntry.mockResolvedValue({ id: "entry-1" });
    const { postLedgerEntry } = await import("../ledger");
    await expect(postLedgerEntry(baseInput)).resolves.toBeTruthy();
  });
});

function entry(overrides: Partial<Record<string, unknown>>) {
  return {
    id: `e-${Math.random()}`,
    entryType: "SERVICE_VERIFIED",
    category: null,
    minutes: 0,
    amountCents: null,
    approvalStatus: "APPROVED",
    ...overrides,
  };
}

describe("getHouseholdLedgerTotals — acceptance scenario 1", () => {
  it("required 20h, verified event 8h + non-event 4h, pending 2h, purchased 3h, waived 1h -> verified=12h, remaining computed elsewhere = 4h", async () => {
    findManyEntries.mockResolvedValue([
      entry({ entryType: "SERVICE_VERIFIED", category: "EVENT_SERVICE", minutes: 480, approvalStatus: "APPROVED" }), // 8h
      entry({ entryType: "SERVICE_VERIFIED", category: "ADMINISTRATIVE_SUPPORT", minutes: 240, approvalStatus: "APPROVED" }), // 4h
      entry({ entryType: "SERVICE_VERIFIED", category: "CLASSROOM_SERVICE", minutes: 120, approvalStatus: "PENDING" }), // 2h pending
      entry({ entryType: "PURCHASE", minutes: 180 }), // 3h purchased
      entry({ entryType: "WAIVER", minutes: 60, reason: "board decision" }), // 1h waived
    ]);

    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");

    expect(totals.verifiedMinutes).toBe(720); // 12h
    expect(totals.eventMinutes).toBe(480);
    expect(totals.nonEventMinutes).toBe(240);
    expect(totals.pendingMinutes).toBe(120);
    expect(totals.purchasedMinutes).toBe(180);
    expect(totals.waivedMinutes).toBe(60);
  });
});

describe("getHouseholdLedgerTotals — approval-status exclusion (spec §10/§14)", () => {
  it("never folds PENDING entries into verifiedMinutes", async () => {
    findManyEntries.mockResolvedValue([entry({ entryType: "SERVICE_VERIFIED", minutes: 600, approvalStatus: "PENDING" })]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.verifiedMinutes).toBe(0);
    expect(totals.pendingMinutes).toBe(600);
  });

  it("never folds REJECTED entries into verifiedMinutes", async () => {
    findManyEntries.mockResolvedValue([entry({ entryType: "SERVICE_VERIFIED", minutes: 600, approvalStatus: "REJECTED" })]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.verifiedMinutes).toBe(0);
    expect(totals.rejectedMinutes).toBe(600);
  });

  it("purchased and waived minutes are never included in verifiedMinutes — reported in their own columns", async () => {
    findManyEntries.mockResolvedValue([
      entry({ entryType: "PURCHASE", minutes: 300 }),
      entry({ entryType: "WAIVER", minutes: 100, reason: "x" }),
      entry({ entryType: "ADMIN_CREDIT", minutes: 50, reason: "x" }),
    ]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.verifiedMinutes).toBe(0);
    expect(totals.purchasedMinutes).toBe(300);
    expect(totals.waivedMinutes).toBe(100);
    expect(totals.creditMinutes).toBe(50);
  });

  it("nets PURCHASE_REFUND against PURCHASE, floored at zero", async () => {
    findManyEntries.mockResolvedValue([
      entry({ entryType: "PURCHASE", minutes: 300 }),
      entry({ entryType: "PURCHASE_REFUND", minutes: 500 }), // over-refund edge case
    ]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.purchasedMinutes).toBe(0);
  });
});

describe("getHouseholdLedgerTotals — financial rollup", () => {
  it("computes outstanding balance as charge minus payments minus refunds minus write-offs, floored at zero", async () => {
    findManyEntries.mockResolvedValue([
      entry({ entryType: "ASSESSMENT_CHARGE", amountCents: 12_500 }),
      entry({ entryType: "PAYMENT_ELECTRONIC", amountCents: 5_000 }),
      entry({ entryType: "PAYMENT_OFFLINE", amountCents: 2_000 }),
      entry({ entryType: "REFUND", amountCents: 500 }),
    ]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.outstandingBalanceCents).toBe(12_500 - 5_000 - 2_000 - 500);
  });

  it("never goes negative when payments exceed the charge", async () => {
    findManyEntries.mockResolvedValue([
      entry({ entryType: "ASSESSMENT_CHARGE", amountCents: 1_000 }),
      entry({ entryType: "PAYMENT_ELECTRONIC", amountCents: 5_000 }),
    ]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.outstandingBalanceCents).toBe(0);
  });
});

describe("mirrorHourEntryApprovalToLedger", () => {
  it("is a no-op when the raw entry has no denormalized householdId", async () => {
    const { mirrorHourEntryApprovalToLedger } = await import("../ledger");
    const result = await mirrorHourEntryApprovalToLedger("org-1", {
      id: "he-1",
      householdId: null,
      householdAdultId: "adult-1",
      creditedMinutes: 60,
      category: null,
      opportunityId: "opp-1",
      approvedByUserId: "u1",
    });
    expect(result).toBeNull();
    expect(findFirstPeriod).not.toHaveBeenCalled();
  });

  it("is a no-op when no period is currently active", async () => {
    findFirstPeriod.mockResolvedValue(null);
    const { mirrorHourEntryApprovalToLedger } = await import("../ledger");
    const result = await mirrorHourEntryApprovalToLedger("org-1", {
      id: "he-1",
      householdId: "hh-1",
      householdAdultId: "adult-1",
      creditedMinutes: 60,
      category: null,
      opportunityId: "opp-1",
      approvedByUserId: "u1",
    });
    expect(result).toBeNull();
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("infers EVENT_SERVICE when the opportunity is event-linked and no explicit category was set", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    findUniqueOpportunity.mockResolvedValue({ eventId: "event-1" });
    createEntry.mockResolvedValue({ id: "entry-1" });
    const { mirrorHourEntryApprovalToLedger } = await import("../ledger");
    await mirrorHourEntryApprovalToLedger("org-1", {
      id: "he-1",
      householdId: "hh-1",
      householdAdultId: "adult-1",
      creditedMinutes: 60,
      category: null,
      opportunityId: "opp-1",
      approvedByUserId: "u1",
    });
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ category: "EVENT_SERVICE" }) }));
  });

  it("infers OTHER_APPROVED_SERVICE for a non-event opportunity with no explicit category", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    findUniqueOpportunity.mockResolvedValue({ eventId: null });
    createEntry.mockResolvedValue({ id: "entry-1" });
    const { mirrorHourEntryApprovalToLedger } = await import("../ledger");
    await mirrorHourEntryApprovalToLedger("org-1", {
      id: "he-1",
      householdId: "hh-1",
      householdAdultId: "adult-1",
      creditedMinutes: 60,
      category: null,
      opportunityId: "opp-1",
      approvedByUserId: "u1",
    });
    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ category: "OTHER_APPROVED_SERVICE" }) })
    );
  });

  it("respects an explicitly-set category over the event-linkage inference", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    findUniqueOpportunity.mockResolvedValue({ eventId: "event-1" });
    createEntry.mockResolvedValue({ id: "entry-1" });
    const { mirrorHourEntryApprovalToLedger } = await import("../ledger");
    await mirrorHourEntryApprovalToLedger("org-1", {
      id: "he-1",
      householdId: "hh-1",
      householdAdultId: "adult-1",
      creditedMinutes: 60,
      category: "FUNDRAISING",
      opportunityId: "opp-1",
      approvedByUserId: "u1",
    });
    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ category: "FUNDRAISING" }) }));
  });
});

const hourEntryFixture = {
  id: "he-1",
  householdId: "hh-1",
  householdAdultId: "adult-1",
  creditedMinutes: 60,
  category: "FUNDRAISING" as const,
  opportunityId: "opp-1",
};

describe("mirrorHourEntryPendingToLedger (VH-L follow-up)", () => {
  it("is a no-op when the raw entry has no denormalized householdId", async () => {
    const { mirrorHourEntryPendingToLedger } = await import("../ledger");
    const result = await mirrorHourEntryPendingToLedger("org-1", { ...hourEntryFixture, householdId: null });
    expect(result).toBeNull();
    expect(findFirstPeriod).not.toHaveBeenCalled();
  });

  it("is a no-op when no period is currently active", async () => {
    findFirstPeriod.mockResolvedValue(null);
    const { mirrorHourEntryPendingToLedger } = await import("../ledger");
    const result = await mirrorHourEntryPendingToLedger("org-1", hourEntryFixture);
    expect(result).toBeNull();
    expect(createEntry).not.toHaveBeenCalled();
  });

  it("creates a fresh PENDING ledger row when none exists yet", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    createEntry.mockResolvedValue({ id: "ledger-1" });
    const { mirrorHourEntryPendingToLedger } = await import("../ledger");
    await mirrorHourEntryPendingToLedger("org-1", hourEntryFixture);
    expect(findFirstEntry).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sourceType: "hourEntry", sourceId: "he-1", entryType: "SERVICE_VERIFIED" }) })
    );
    expect(createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approvalStatus: "PENDING", minutes: 60, sourceId: "he-1" }) })
    );
    expect(updateEntry).not.toHaveBeenCalled();
  });
});

describe("mirrorHourEntryApprovalToLedger — transitions an existing PENDING mirror row in place (VH-L follow-up)", () => {
  it("UPDATEs the existing mirror row to APPROVED rather than creating a second row", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    findFirstEntry.mockResolvedValue({ id: "ledger-1", approvalStatus: "PENDING", approvedByUserId: null });
    updateEntry.mockResolvedValue({ id: "ledger-1", approvalStatus: "APPROVED" });

    const { mirrorHourEntryApprovalToLedger } = await import("../ledger");
    const result = await mirrorHourEntryApprovalToLedger("org-1", { ...hourEntryFixture, approvedByUserId: "officer-1" });

    expect(updateEntry).toHaveBeenCalledWith({
      where: { id: "ledger-1" },
      data: expect.objectContaining({ approvalStatus: "APPROVED", minutes: 60, approvedByUserId: "officer-1" }),
    });
    expect(createEntry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ approvalStatus: "APPROVED" });
  });

  it("still falls back to creating fresh when no PENDING mirror row exists (e.g. the feature was enabled after the entry was created)", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    findFirstEntry.mockResolvedValue(undefined);
    createEntry.mockResolvedValue({ id: "ledger-1", approvalStatus: "APPROVED" });

    const { mirrorHourEntryApprovalToLedger } = await import("../ledger");
    await mirrorHourEntryApprovalToLedger("org-1", { ...hourEntryFixture, approvedByUserId: "officer-1" });

    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalStatus: "APPROVED" }) }));
    expect(updateEntry).not.toHaveBeenCalled();
  });
});

describe("mirrorHourEntryRejectionToLedger (VH-L follow-up)", () => {
  it("UPDATEs the existing PENDING mirror row to REJECTED rather than creating a second row", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    findFirstEntry.mockResolvedValue({ id: "ledger-1", approvalStatus: "PENDING", approvedByUserId: null });
    updateEntry.mockResolvedValue({ id: "ledger-1", approvalStatus: "REJECTED" });

    const { mirrorHourEntryRejectionToLedger } = await import("../ledger");
    const result = await mirrorHourEntryRejectionToLedger("org-1", { ...hourEntryFixture, rejectedByUserId: "officer-1" });

    expect(updateEntry).toHaveBeenCalledWith({
      where: { id: "ledger-1" },
      data: expect.objectContaining({ approvalStatus: "REJECTED", approvedByUserId: "officer-1" }),
    });
    expect(createEntry).not.toHaveBeenCalled();
    expect(result).toMatchObject({ approvalStatus: "REJECTED" });
  });

  it("is a no-op when the raw entry has no denormalized householdId", async () => {
    const { mirrorHourEntryRejectionToLedger } = await import("../ledger");
    const result = await mirrorHourEntryRejectionToLedger("org-1", { ...hourEntryFixture, householdId: null, rejectedByUserId: "officer-1" });
    expect(result).toBeNull();
  });

  it("falls back to creating fresh when no PENDING mirror row exists", async () => {
    findFirstPeriod.mockResolvedValue({ id: "period-1" });
    findFirstEntry.mockResolvedValue(undefined);
    createEntry.mockResolvedValue({ id: "ledger-1", approvalStatus: "REJECTED" });

    const { mirrorHourEntryRejectionToLedger } = await import("../ledger");
    await mirrorHourEntryRejectionToLedger("org-1", { ...hourEntryFixture, rejectedByUserId: "officer-1" });

    expect(createEntry).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalStatus: "REJECTED" }) }));
  });
});

describe("getHouseholdLedgerTotals — pending/rejected totals now reflect a real mirror row (VH-L follow-up acceptance check)", () => {
  it("a PENDING mirror row created for a fresh hour entry surfaces as pendingMinutes, not zero", async () => {
    findManyEntries.mockResolvedValue([entry({ entryType: "SERVICE_VERIFIED", minutes: 90, approvalStatus: "PENDING" })]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.pendingMinutes).toBe(90);
    expect(totals.verifiedMinutes).toBe(0);
  });

  it("after the same mirror row transitions to APPROVED, it counts as verified and no longer as pending", async () => {
    findManyEntries.mockResolvedValue([entry({ entryType: "SERVICE_VERIFIED", minutes: 90, approvalStatus: "APPROVED" })]);
    const { getHouseholdLedgerTotals } = await import("../ledger");
    const totals = await getHouseholdLedgerTotals("org-1", "period-1", "hh-1");
    expect(totals.pendingMinutes).toBe(0);
    expect(totals.verifiedMinutes).toBe(90);
  });
});
