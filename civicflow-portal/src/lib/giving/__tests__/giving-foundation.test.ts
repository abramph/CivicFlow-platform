import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
const upsertOrgSettings = vi.fn();
const findFirstFund = vi.fn();
const createFundRow = vi.fn();
const updateFundRow = vi.fn();
const findFirstProgram = vi.fn();
const createProgramRow = vi.fn();
const updateProgramRow = vi.fn();
const countContributions = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: {
      findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a),
      upsert: (...a: unknown[]) => upsertOrgSettings(...a),
    },
    fund: {
      findFirst: (...a: unknown[]) => findFirstFund(...a),
      findMany: vi.fn().mockResolvedValue([]),
      create: (...a: unknown[]) => createFundRow(...a),
      update: (...a: unknown[]) => updateFundRow(...a),
    },
    contributionProgram: {
      findFirst: (...a: unknown[]) => findFirstProgram(...a),
      findMany: vi.fn().mockResolvedValue([]),
      create: (...a: unknown[]) => createProgramRow(...a),
      update: (...a: unknown[]) => updateProgramRow(...a),
    },
    contribution: { count: (...a: unknown[]) => countContributions(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { ensureContributionsEnabled } from "@/lib/giving/module";
import { createFund, updateFund } from "@/lib/giving/funds";
import { createProgram, resolveObligationNature, updateProgram } from "@/lib/giving/programs";
import { formatContributionNumber, nextContributionNumber, withContributionNumber } from "@/lib/giving/contribution-numbers";
import { prisma } from "@/lib/prisma";

const actor = { actorUserId: "treasurer-1", actorEmail: "treasurer@example.org" };

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true, contributionTerminology: null });
  createFundRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "f1", ...args.data }));
  createProgramRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "p1", ...args.data }));
  updateProgramRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "p1", name: "x", ...args.data }));
});

describe("module gate (§84 — default OFF)", () => {
  it("everything refuses when the flag is off or settings are absent", async () => {
    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: false });
    await expect(ensureContributionsEnabled("org-1")).rejects.toMatchObject({ name: "FinanceError", status: 403 });
    findUniqueOrgSettings.mockResolvedValueOnce(null);
    await expect(ensureContributionsEnabled("org-1")).rejects.toMatchObject({ status: 403 });
  });
});

describe("obligation nature — THE non-negotiable (§5)", () => {
  it("REQUIRED is legal only for DUES; requesting it elsewhere is a hard 422", () => {
    expect(resolveObligationNature("DUES", "REQUIRED")).toBe("REQUIRED");
    expect(resolveObligationNature("DUES", undefined)).toBe("REQUIRED");
    expect(() => resolveObligationNature("VOLUNTARY_CONTRIBUTION", "REQUIRED")).toThrowError(/never creates debt/);
    expect(() => resolveObligationNature("PLEDGE_CAMPAIGN", "REQUIRED")).toThrowError();
    expect(() => resolveObligationNature("SUGGESTED_CONTRIBUTION", "REQUIRED")).toThrowError();
  });

  it("every non-dues type is forced VOLUNTARY on create, whatever the caller sends", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "General Fund", status: "ACTIVE" });
    const program = await createProgram({
      organizationId: "org-1",
      fundId: "f1",
      name: "Sunday Giving",
      type: "VOLUNTARY_CONTRIBUTION",
      ...actor,
    });
    expect(program.obligationNature).toBe("VOLUNTARY");
  });

  it("changing a dues program to a voluntary type drops the REQUIRED nature rather than carrying it", async () => {
    findFirstProgram.mockResolvedValueOnce({ id: "p1", organizationId: "org-1", fundId: "f1", type: "DUES", obligationNature: "REQUIRED" });
    await expect(
      updateProgram({ organizationId: "org-1", programId: "p1", type: "VOLUNTARY_CONTRIBUTION", ...actor })
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("fund lifecycle (§4, §98)", () => {
  it("there is no delete — only the status machine; ARCHIVED is terminal", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "Old Fund", status: "ARCHIVED" });
    await expect(updateFund({ organizationId: "org-1", fundId: "f1", status: "ACTIVE", ...actor })).rejects.toMatchObject({ status: 409 });
  });

  it("closed/archived funds refuse new programs", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "Building Fund", status: "CLOSED" });
    await expect(
      createProgram({ organizationId: "org-1", fundId: "f1", name: "New Program", ...actor })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("amount sanity: max below min refused; archiving stamps archivedAt", async () => {
    await expect(
      createFund({ organizationId: "org-1", name: "F", minimumAmount: 100, maximumAmount: 50, ...actor })
    ).rejects.toMatchObject({ name: "FinanceError" });

    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "Closed Fund", status: "CLOSED" });
    updateFundRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "f1", name: "Closed Fund", status: "ARCHIVED", ...args.data }));
    await updateFund({ organizationId: "org-1", fundId: "f1", status: "ARCHIVED", ...actor });
    expect(updateFundRow.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("tenant isolation", () => {
  it("funds and programs are always looked up org-scoped", async () => {
    findFirstFund.mockResolvedValueOnce(null);
    await expect(updateFund({ organizationId: "org-1", fundId: "foreign", ...actor })).rejects.toMatchObject({ status: 404 });
    expect(findFirstFund.mock.calls[0][0].where).toMatchObject({ id: "foreign", organizationId: "org-1" });

    findFirstProgram.mockResolvedValueOnce(null);
    await expect(updateProgram({ organizationId: "org-1", programId: "foreign", ...actor })).rejects.toMatchObject({ status: 404 });
    expect(findFirstProgram.mock.calls[0][0].where).toMatchObject({ id: "foreign", organizationId: "org-1" });
  });
});

describe("contribution numbers (§36)", () => {
  it("formats CTR-YYYY-NNNNNN and allocates from the per-org per-year count", async () => {
    expect(formatContributionNumber(2026, 1482)).toBe("CTR-2026-001482");
    countContributions.mockResolvedValueOnce(41);
    const number = await nextContributionNumber(prisma, "org-1", 2026);
    expect(number).toBe("CTR-2026-000042");
    expect(countContributions.mock.calls[0][0].where).toMatchObject({
      organizationId: "org-1",
      contributionNumber: { startsWith: "CTR-2026-" },
    });
  });

  it("retries on unique collision and surfaces the error after three attempts", async () => {
    countContributions.mockResolvedValue(0);
    const create = vi.fn().mockRejectedValueOnce({ code: "P2002" }).mockResolvedValueOnce({ id: "c1" });
    const result = await withContributionNumber("org-1", create);
    expect(result).toEqual({ id: "c1" });
    expect(create).toHaveBeenCalledTimes(2);

    const alwaysCollides = vi.fn().mockRejectedValue({ code: "P2002" });
    await expect(withContributionNumber("org-1", alwaysCollides)).rejects.toMatchObject({ code: "P2002" });
    expect(alwaysCollides).toHaveBeenCalledTimes(3);
  });
});
