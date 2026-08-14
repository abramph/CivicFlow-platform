import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
const findUniqueOrg = vi.fn();
const findManyContributions = vi.fn();
const countContributions = vi.fn();
const groupByContributions = vi.fn();
const findFirstStatement = vi.fn();
const createStatement = vi.fn();
const updateStatement = vi.fn();
const uploadBufferToSpaces = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    organization: { findUnique: (...a: unknown[]) => findUniqueOrg(...a) },
    contribution: {
      findMany: (...a: unknown[]) => findManyContributions(...a),
      count: (...a: unknown[]) => countContributions(...a),
      groupBy: (...a: unknown[]) => groupByContributions(...a),
    },
    contributionStatement: {
      findFirst: (...a: unknown[]) => findFirstStatement(...a),
      create: (...a: unknown[]) => createStatement(...a),
      update: (...a: unknown[]) => updateStatement(...a),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/storage", () => ({
  buildSafeObjectKey: (prefix: string, name: string) => `${prefix}/mock/${name}`,
  uploadBufferToSpaces: (...args: unknown[]) => uploadBufferToSpaces(...args),
}));

import { collectStatementData, generateStatement, statementExceptions, statementFooter } from "@/lib/giving/statements";

function contributionRow(amount: number, options: Record<string, unknown> = {}) {
  return {
    contributionNumber: "CTR-2026-000001",
    contributionDate: new Date("2026-05-01"),
    amount,
    goodsServicesValue: null,
    taxDeductibilityClassification: "DEDUCTIBILITY_NOT_CONFIGURED",
    notes: null,
    fund: { name: "General Fund" },
    campaign: null,
    contributionProgram: null,
    ...options,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true });
  findUniqueOrg.mockResolvedValue({ name: "Demo Org" });
  createStatement.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "st-1", ...args.data }));
  countContributions.mockResolvedValue(0);
  groupByContributions.mockResolvedValue([]);
});

describe("statement data collection (§30)", () => {
  it("only statement-eligible, non-void rows inside the calendar year", async () => {
    findManyContributions.mockResolvedValueOnce([]);
    await collectStatementData("org-1", { memberId: "m1" }, 2026);
    const where = findManyContributions.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: "org-1", voidedAt: null, statementEligible: true });
    expect(where.contributionDate.gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(where.contributionDate.lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(where.OR).toEqual([{ memberId: "m1" }]);
  });
});

describe("§31 tax-safety wording", () => {
  it("stays neutral when nothing is configured, and never claims deductibility on its own", () => {
    const neutral = statementFooter([{ taxDeductibilityClassification: "DEDUCTIBILITY_NOT_CONFIGURED" }]);
    expect(neutral).toMatch(/record of contributions/i);
    expect(neutral).not.toMatch(/tax-deductible donation receipt/i);

    const notDeductible = statementFooter([{ taxDeductibilityClassification: "NOT_DEDUCTIBLE" }]);
    expect(notDeductible).toMatch(/not tax-deductible/);

    const mixed = statementFooter([
      { taxDeductibilityClassification: "ORGANIZATION_MARKED_POTENTIALLY_DEDUCTIBLE" },
      { taxDeductibilityClassification: "DEDUCTIBILITY_NOT_CONFIGURED" },
    ]);
    expect(mixed).toMatch(/not tax advice/);
  });
});

describe("versioning (§94)", () => {
  it("first generation is v1; reissue requires a reason, supersedes the prior, links it, audits", async () => {
    findManyContributions.mockResolvedValue([contributionRow(100)]);
    findFirstStatement.mockResolvedValueOnce(null);
    const first = await generateStatement({
      organizationId: "org-1",
      subject: { memberId: "m1" },
      subjectName: "Pat Member",
      year: 2026,
      generatedByUserId: "fin-1",
    });
    expect(first.version).toBe(1);
    expect(uploadBufferToSpaces).toHaveBeenCalled();

    // Reissue without a reason → refused.
    findFirstStatement.mockResolvedValueOnce({ id: "st-old", version: 1 });
    await expect(
      generateStatement({ organizationId: "org-1", subject: { memberId: "m1" }, subjectName: "Pat", year: 2026, generatedByUserId: "fin-1" })
    ).rejects.toMatchObject({ status: 409 });

    // Reissue with a reason → v2, prior superseded + linked.
    findFirstStatement.mockResolvedValueOnce({ id: "st-old", version: 1 });
    const second = await generateStatement({
      organizationId: "org-1",
      subject: { memberId: "m1" },
      subjectName: "Pat",
      year: 2026,
      reason: "Corrected check amount after deposit reconciliation",
      generatedByUserId: "fin-1",
    });
    expect(second.version).toBe(2);
    expect(updateStatement.mock.calls[0][0]).toMatchObject({
      where: { id: "st-old" },
      data: { status: "SUPERSEDED", supersededById: "st-1" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "giving.statement_generated", metadata: expect.objectContaining({ reissue: true }) })
    );
  });

  it("no eligible contributions → 404, nothing uploaded or recorded", async () => {
    findManyContributions.mockResolvedValueOnce([]);
    await expect(
      generateStatement({ organizationId: "org-1", subject: { memberId: "m1" }, subjectName: "Pat", year: 2026, generatedByUserId: "fin-1" })
    ).rejects.toMatchObject({ status: 404 });
    expect(uploadBufferToSpaces).not.toHaveBeenCalled();
    expect(createStatement).not.toHaveBeenCalled();
  });
});

describe("exception report (§96)", () => {
  it("names unattributed and unassigned contributions with counts", async () => {
    countContributions.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    groupByContributions.mockResolvedValueOnce([{ providerPaymentIntentId: "pi_dup", _count: 2 }]);
    const exceptions = await statementExceptions("org-1", 2026);
    expect(exceptions.map((exception) => exception.kind).sort()).toEqual([
      "duplicate_provider_reference",
      "unassigned_designation",
      "unattributed",
    ]);
    expect(exceptions.find((exception) => exception.kind === "unattributed")?.count).toBe(2);
  });

  it("a clean year returns no exceptions", async () => {
    countContributions.mockResolvedValue(0);
    groupByContributions.mockResolvedValueOnce([]);
    await expect(statementExceptions("org-1", 2026)).resolves.toEqual([]);
  });
});
