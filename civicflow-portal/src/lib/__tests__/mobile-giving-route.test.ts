import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileMembership = vi.fn();
const findUniqueOrgSettings = vi.fn();
const findManyFunds = vi.fn();
const findManyContributions = vi.fn();
const findManyStatements = vi.fn();
const findFirstStatement = vi.fn();
const listMySchedules = vi.fn();
const listMyPledges = vi.fn();
const getSignedObjectUrl = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/mobile-auth", () => ({
  requireMobileMembership: (...args: unknown[]) => requireMobileMembership(...args),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    fund: { findMany: (...a: unknown[]) => findManyFunds(...a) },
    contribution: { findMany: (...a: unknown[]) => findManyContributions(...a) },
    contributionStatement: {
      findMany: (...a: unknown[]) => findManyStatements(...a),
      findFirst: (...a: unknown[]) => findFirstStatement(...a),
    },
  },
}));
vi.mock("@/lib/giving/recurring", () => ({ listMySchedules: (...a: unknown[]) => listMySchedules(...a) }));
vi.mock("@/lib/giving/pledges", () => ({ listMyPledges: (...a: unknown[]) => listMyPledges(...a) }));
vi.mock("@/lib/storage", () => ({ getSignedObjectUrl: (...a: unknown[]) => getSignedObjectUrl(...a) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { GET as getGiving } from "@/app/api/mobile/giving/route";
import { GET as getStatement } from "@/app/api/mobile/giving/statements/[statementId]/route";

const MOBILE_CONTEXT = {
  session: { userId: "user-1" },
  organizationId: "org-1",
  memberId: "member-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileMembership.mockResolvedValue(MOBILE_CONTEXT);
  findManyFunds.mockResolvedValue([]);
  findManyContributions.mockResolvedValue([]);
  findManyStatements.mockResolvedValue([]);
  listMySchedules.mockResolvedValue([]);
  listMyPledges.mockResolvedValue([]);
});

describe("GET /api/mobile/giving (CORE-GIVE-L)", () => {
  it("module off → { enabled: false } and NOTHING else is queried", async () => {
    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: false });
    const response = await getGiving(new Request("http://x/api/mobile/giving?organizationId=org-1"));
    const payload = await response.json();
    expect(payload).toEqual({ ok: true, data: { enabled: false } });
    expect(findManyFunds).not.toHaveBeenCalled();
    expect(findManyContributions).not.toHaveBeenCalled();
  });

  it("history and statements are scoped to the CALLER's own member/user rows", async () => {
    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: true, contributionTerminology: "Giving" });
    const response = await getGiving(new Request("http://x/api/mobile/giving?organizationId=org-1"));
    expect(response.status).toBe(200);
    // Every contribution query carries the caller-only OR clause.
    for (const call of findManyContributions.mock.calls) {
      expect(call[0].where.OR).toEqual([{ memberId: "member-1" }, { contributorUserId: "user-1" }]);
    }
    const statementWhere = findManyStatements.mock.calls[0][0].where;
    expect(statementWhere.OR).toEqual([{ memberId: "member-1" }, { contributorUserId: "user-1" }]);
    expect(listMySchedules).toHaveBeenCalledWith("org-1", "user-1");
  });

  it("year total is net of refunds", async () => {
    findUniqueOrgSettings.mockResolvedValueOnce({ contributionsEnabled: true, contributionTerminology: "Giving" });
    findManyContributions
      .mockResolvedValueOnce([]) // history
      .mockResolvedValueOnce([
        { amount: 100, refundedAmount: 25 },
        { amount: 50, refundedAmount: null },
      ]); // year rows
    const response = await getGiving(new Request("http://x/api/mobile/giving?organizationId=org-1"));
    const payload = await response.json();
    expect(payload.data.yearTotal).toBe(125);
  });

  it("MOBILE-COVER: exposes the org's coverage offer and each schedule's coverage preference", async () => {
    findUniqueOrgSettings
      .mockResolvedValueOnce({ contributionsEnabled: true, contributionTerminology: "Giving" })
      .mockResolvedValueOnce({
        processingCostCoverageMode: "OPTIONAL_CONTRIBUTOR_COVERAGE",
        processingCostCoveragePercentBps: 290,
        processingCostCoverageFixedCents: 30,
      });
    listMySchedules.mockResolvedValueOnce([
      {
        id: "sched-1",
        fund: { name: "General" },
        amount: 50,
        frequency: "MONTHLY",
        status: "ACTIVE",
        nextContributionDate: null,
        paymentMethodDescriptor: null,
        coverProcessingCosts: true,
      },
    ]);
    const response = await getGiving(new Request("http://x/api/mobile/giving?organizationId=org-1"));
    const payload = await response.json();
    expect(payload.data.coverage).toEqual({ offered: true, percentBps: 290, fixedCents: 30 });
    expect(payload.data.schedules[0].coverProcessingCosts).toBe(true);
  });

  it("MOBILE-COVER: org mode OFF (or unset) → offered:false, so the native toggle never renders", async () => {
    findUniqueOrgSettings
      .mockResolvedValueOnce({ contributionsEnabled: true, contributionTerminology: "Giving" })
      .mockResolvedValueOnce({
        processingCostCoverageMode: "OFF",
        processingCostCoveragePercentBps: 290,
        processingCostCoverageFixedCents: 30,
      });
    const response = await getGiving(new Request("http://x/api/mobile/giving?organizationId=org-1"));
    const payload = await response.json();
    expect(payload.data.coverage).toEqual({ offered: false, percentBps: 290, fixedCents: 30 });
  });
});

describe("GET /api/mobile/giving/statements/[statementId] — subject only", () => {
  it("someone else's statement (or a household statement) → 404, nothing signed", async () => {
    findFirstStatement.mockResolvedValueOnce(null);
    const response = await getStatement(new Request("http://x/api/mobile/giving/statements/st-1?organizationId=org-1"), {
      params: Promise.resolve({ statementId: "st-1" }),
    });
    expect(response.status).toBe(404);
    const where = findFirstStatement.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ memberId: "member-1" }, { contributorUserId: "user-1" }]);
    expect(getSignedObjectUrl).not.toHaveBeenCalled();
  });

  it("the caller's own statement returns a signed URL and audits the download", async () => {
    findFirstStatement.mockResolvedValueOnce({ id: "st-1", year: 2026, version: 1, objectKey: "statements/org-1/x.pdf" });
    getSignedObjectUrl.mockResolvedValueOnce("https://signed.example/x.pdf");
    const response = await getStatement(new Request("http://x/api/mobile/giving/statements/st-1?organizationId=org-1"), {
      params: Promise.resolve({ statementId: "st-1" }),
    });
    const payload = await response.json();
    expect(payload.data.url).toBe("https://signed.example/x.pdf");
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "giving.statement_downloaded", metadata: expect.objectContaining({ via: "mobile" }) })
    );
  });
});
