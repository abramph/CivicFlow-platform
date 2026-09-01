import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyExpenditure = vi.fn().mockResolvedValue([]);
const findManyCommittee = vi.fn().mockResolvedValue([]);
const findFirstCommittee = vi.fn();
const transaction = vi.fn();
const txUpdateManyExpenditure = vi.fn();
const txFindFirstExpenditure = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    expenditure: { findMany: (...a: unknown[]) => findManyExpenditure(...a) },
    ptaCommittee: {
      findMany: (...a: unknown[]) => findManyCommittee(...a),
      findFirst: (...a: unknown[]) => findFirstCommittee(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

import { listExpenditures, assertCommitteeInOrganization, getOrganizationCommitteeOptions, voidExpenditure, describeCommitteeAttribution } from "@/lib/expenditures";

beforeEach(() => {
  vi.clearAllMocks();
  findManyExpenditure.mockResolvedValue([]);
  txUpdateManyExpenditure.mockResolvedValue({ count: 1 });
  txFindFirstExpenditure.mockResolvedValue({ id: "exp-1", voidedAt: new Date(), voidReason: "Duplicate", receiptUrl: "https://x/receipt.pdf" });
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      expenditure: {
        updateMany: (...a: unknown[]) => txUpdateManyExpenditure(...a),
        findFirst: (...a: unknown[]) => txFindFirstExpenditure(...a),
      },
    })
  );
});

describe("listExpenditures", () => {
  it("always scopes by organizationId, with no filters applied by default", async () => {
    await listExpenditures("org-1");
    expect(findManyExpenditure.mock.calls[0][0].where).toEqual({ organizationId: "org-1" });
  });

  it("applies a date range filter", async () => {
    await listExpenditures("org-1", { dateFrom: "2026-01-01", dateTo: "2026-06-30" });
    expect(findManyExpenditure.mock.calls[0][0].where.date).toEqual({ gte: new Date("2026-01-01"), lte: new Date("2026-06-30") });
  });

  it("ignores an unparseable date rather than throwing", async () => {
    await listExpenditures("org-1", { dateFrom: "not-a-date" });
    expect(findManyExpenditure.mock.calls[0][0].where.date).toBeUndefined();
  });

  it("applies category, payment method, and committee filters", async () => {
    await listExpenditures("org-1", { categoryId: "cat-1", paymentMethodId: "pm-1", committeeId: "committee-1" });
    expect(findManyExpenditure.mock.calls[0][0].where).toMatchObject({ categoryId: "cat-1", paymentMethodId: "pm-1", committeeId: "committee-1" });
  });

  it("applies status ACTIVE as voidedAt: null and VOIDED as voidedAt: { not: null }", async () => {
    await listExpenditures("org-1", { status: "ACTIVE" });
    expect(findManyExpenditure.mock.calls[0][0].where.voidedAt).toEqual(null);
    await listExpenditures("org-1", { status: "VOIDED" });
    expect(findManyExpenditure.mock.calls[1][0].where.voidedAt).toEqual({ not: null });
  });

  it("applies a case-insensitive vendor substring search", async () => {
    await listExpenditures("org-1", { vendor: "Home Depot" });
    expect(findManyExpenditure.mock.calls[0][0].where.vendor).toEqual({ contains: "Home Depot", mode: "insensitive" });
  });

  it("applies origin DIRECT as reimbursement: { is: null } and REIMBURSEMENT as reimbursement: { isNot: null }", async () => {
    await listExpenditures("org-1", { origin: "DIRECT" });
    expect(findManyExpenditure.mock.calls[0][0].where.reimbursement).toEqual({ is: null });
    await listExpenditures("org-1", { origin: "REIMBURSEMENT" });
    expect(findManyExpenditure.mock.calls[1][0].where.reimbursement).toEqual({ isNot: null });
  });

  it("never lets a filter escape organization scoping -- organizationId is always present alongside any combination of filters", async () => {
    await listExpenditures("org-1", { categoryId: "cat-1", committeeId: "committee-1", status: "ACTIVE", origin: "DIRECT", vendor: "x" });
    expect(findManyExpenditure.mock.calls[0][0].where.organizationId).toBe("org-1");
  });
});

describe("assertCommitteeInOrganization", () => {
  it("returns the committee when it belongs to this organization", async () => {
    findFirstCommittee.mockResolvedValueOnce({ id: "committee-1", name: "Fundraising" });
    const committee = await assertCommitteeInOrganization("org-1", "committee-1");
    expect(committee).toEqual({ id: "committee-1", name: "Fundraising" });
    expect(findFirstCommittee).toHaveBeenCalledWith({ where: { id: "committee-1", organizationId: "org-1" }, select: { id: true, name: true } });
  });

  it("rejects a committee id that belongs to a different organization", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    await expect(assertCommitteeInOrganization("org-1", "committee-in-org-2")).rejects.toMatchObject({ name: "FinanceError", status: 404 });
  });

  it("rejects an unknown committee id entirely", async () => {
    findFirstCommittee.mockResolvedValueOnce(null);
    await expect(assertCommitteeInOrganization("org-1", "does-not-exist")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getOrganizationCommitteeOptions", () => {
  it("returns active committees for a PTA organization", async () => {
    findManyCommittee.mockResolvedValueOnce([{ id: "committee-1", name: "Fundraising" }]);
    const options = await getOrganizationCommitteeOptions("org-1", "PTA");
    expect(options).toEqual([{ id: "committee-1", label: "Fundraising" }]);
    expect(findManyCommittee).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-1", status: "ACTIVE" } }));
  });

  it("returns an empty list for a non-PTA organization without even querying the database -- a non-PTA org cannot use a PTA committee id", async () => {
    const options = await getOrganizationCommitteeOptions("org-1", "COMMUNITY");
    expect(options).toEqual([]);
    expect(findManyCommittee).not.toHaveBeenCalled();
  });
});

describe("voidExpenditure", () => {
  const baseInput = {
    organizationId: "org-1",
    expenditureId: "exp-1",
    reason: "Duplicate entry",
    actorUserId: "treasurer-1",
    actorEmail: "treasurer@example.org",
    existing: { id: "exp-1", description: "Poster paper", receiptUrl: "https://x/receipt.pdf" },
  };

  it("CAS-guards the update to rows that are still un-voided, scoped to this organization", async () => {
    await voidExpenditure(baseInput);
    expect(txUpdateManyExpenditure).toHaveBeenCalledWith({
      where: { id: "exp-1", organizationId: "org-1", voidedAt: null },
      data: { voidReason: "Duplicate entry", voidedAt: expect.any(Date), voidedByUserId: "treasurer-1" },
    });
  });

  it("throws a stable 409 FinanceError when zero rows match -- already voided by a concurrent request", async () => {
    txUpdateManyExpenditure.mockResolvedValueOnce({ count: 0 });
    await expect(voidExpenditure(baseInput)).rejects.toMatchObject({ name: "FinanceError", status: 409 });
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("writes the audit event inside the same transaction, excluding receiptUrl from both before/after snapshots", async () => {
    await voidExpenditure(baseInput);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "void", entityType: "expenditure", tx: expect.anything() }));
    const metadata = createAuditEvent.mock.calls[0][0].metadata as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(metadata.before).not.toHaveProperty("receiptUrl");
    expect(metadata.after).not.toHaveProperty("receiptUrl");
  });
});

// feature/pta-treasurer-expenditure-experience (E3 defect found + fixed
// during browser verification) -- the snapshot column was correctly
// written and preserved in the database all along; the bug was purely in
// display precedence (ledger table + both detail pages originally showed
// the LIVE committee.name whenever the FK still resolved, falling back to
// committeeNameAtPosting only once the committee was deleted). That makes
// a rename NOT harmless to historical reporting, contradicting the
// migration's own documented intent. These pin the corrected precedence.
describe("describeCommitteeAttribution", () => {
  it("shows the snapshot, not the live name, when the committee still exists but was renamed since posting", () => {
    const result = describeCommitteeAttribution({ committee: { name: "Fundraising & Development" }, committeeNameAtPosting: "Fundraising" });
    expect(result.display).toBe("Fundraising");
    expect(result.helper).toMatch(/now named "Fundraising & Development"/);
  });

  it("shows the snapshot with an archived/removed helper when the committee no longer exists", () => {
    const result = describeCommitteeAttribution({ committee: null, committeeNameAtPosting: "Fundraising" });
    expect(result.display).toBe("Fundraising");
    expect(result.helper).toMatch(/archived or removed/);
  });

  it("shows the name with no helper when the live committee and the snapshot agree", () => {
    const result = describeCommitteeAttribution({ committee: { name: "Fundraising" }, committeeNameAtPosting: "Fundraising" });
    expect(result.display).toBe("Fundraising");
    expect(result.helper).toBeUndefined();
  });

  it("shows 'No committee' with no helper when neither exists", () => {
    const result = describeCommitteeAttribution({ committee: null, committeeNameAtPosting: null });
    expect(result).toEqual({ display: "No committee" });
  });
});
