import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
const findFirstFund = vi.fn();
const findFirstMember = vi.fn();
const findFirstProgram = vi.fn();
const findFirstPledge = vi.fn();
const findFirstContribution = vi.fn();
const createContribution = vi.fn();
const updateContribution = vi.fn();
const countContributions = vi.fn();
const findManySchedules = vi.fn();
const groupByContributions = vi.fn();
const aggregateContributions = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
const sessionsList = vi.fn();
const invoicesList = vi.fn();
const findUniqueStripeAccount = vi.fn();
const connectedSessionsList = vi.fn();
const connectedInvoicesList = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    fund: { findFirst: (...a: unknown[]) => findFirstFund(...a) },
    orgMember: { findFirst: (...a: unknown[]) => findFirstMember(...a) },
    contributionProgram: { findFirst: (...a: unknown[]) => findFirstProgram(...a) },
    pledge: { findFirst: (...a: unknown[]) => findFirstPledge(...a), update: vi.fn() },
    contribution: {
      findFirst: (...a: unknown[]) => findFirstContribution(...a),
      findMany: vi.fn().mockResolvedValue([]),
      create: (...a: unknown[]) => createContribution(...a),
      update: (...a: unknown[]) => updateContribution(...a),
      count: (...a: unknown[]) => countContributions(...a),
      groupBy: (...a: unknown[]) => groupByContributions(...a),
      aggregate: (...a: unknown[]) => aggregateContributions(...a),
    },
    recurringContributionSchedule: { findMany: (...a: unknown[]) => findManySchedules(...a) },
    organizationStripeAccount: { findUnique: (...a: unknown[]) => findUniqueStripeAccount(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: { sessions: { list: (...a: unknown[]) => sessionsList(...a) } },
    invoices: { list: (...a: unknown[]) => invoicesList(...a) },
  }),
}));
vi.mock("@/lib/payments/stripe-connect", () => ({
  getStripeForMode: async () => ({
    checkout: { sessions: { list: (...a: unknown[]) => connectedSessionsList(...a) } },
    invoices: { list: (...a: unknown[]) => connectedInvoicesList(...a) },
  }),
}));

import { correctOfflineContribution, recordOfflineContribution } from "@/lib/giving/offline";
import { getReconciliationReport } from "@/lib/giving/reconciliation";

const actor = { actorUserId: "fin-1", actorEmail: "finance@example.org" };
const baseEntry = {
  organizationId: "org-1",
  fundId: "f1",
  amount: 50,
  method: "CHECK" as const,
  contributionDate: new Date("2026-08-01"),
  contributorName: "Casey Check",
  ...actor,
};

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true });
  findFirstFund.mockResolvedValue({ id: "f1", name: "General Fund", status: "ACTIVE" });
  countContributions.mockResolvedValue(0);
  createContribution.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c-new", revisionNumber: 1, ...args.data }));
  groupByContributions.mockResolvedValue([]);
  findManySchedules.mockResolvedValue([]);
  aggregateContributions.mockResolvedValue({ _sum: { amount: 0 } });
  sessionsList.mockResolvedValue({ data: [] });
  invoicesList.mockResolvedValue({ data: [] });
  connectedSessionsList.mockResolvedValue({ data: [] });
  connectedInvoicesList.mockResolvedValue({ data: [] });
  findUniqueStripeAccount.mockResolvedValue(null);
});

describe("offline entry (§21)", () => {
  it("requires attribution or explicit anonymity, an offline method, and a usable fund", async () => {
    await expect(
      recordOfflineContribution({ ...baseEntry, contributorName: null, memberId: null })
    ).rejects.toMatchObject({ name: "FinanceError" });

    await expect(
      recordOfflineContribution({ ...baseEntry, method: "STRIPE" as never })
    ).rejects.toMatchObject({ name: "FinanceError" });

    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "Closed", status: "CLOSED" });
    await expect(recordOfflineContribution(baseEntry)).rejects.toMatchObject({ status: 409 });
  });

  it("records with a CTR number, MANUAL source, reference in notes, and an audit event", async () => {
    await recordOfflineContribution({ ...baseEntry, reference: "1042" });
    const data = createContribution.mock.calls[0][0].data;
    expect(String(data.contributionNumber)).toMatch(/^CTR-\d{4}-\d{6}$/);
    expect(data).toMatchObject({ source: "MANUAL", paymentMethod: "CHECK", contributorName: "Casey Check" });
    expect(String(data.notes)).toContain("Ref: 1042");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "giving.contribution_offline_recorded" }));
  });

  it("anonymous entries drop the name and mark PUBLICLY_ANONYMOUS — finance can still see the row", async () => {
    await recordOfflineContribution({ ...baseEntry, anonymous: true });
    const data = createContribution.mock.calls[0][0].data;
    expect(data.contributorName).toBeNull();
    expect(data.anonymityMode).toBe("PUBLICLY_ANONYMOUS");
  });

  it("pledge credit uses the same linkage discipline: wrong member's pledge is refused", async () => {
    findFirstMember.mockResolvedValueOnce({ id: "m1", name: "Member One" });
    findFirstPledge.mockResolvedValueOnce({ id: "pl1", memberId: "m-OTHER" });
    await expect(
      recordOfflineContribution({ ...baseEntry, memberId: "m1", pledgeId: "pl1" })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("corrections (§100)", () => {
  it("voids the original with a reason and links the replacement — nothing is deleted", async () => {
    findFirstContribution.mockResolvedValueOnce({
      id: "c-orig",
      voidedAt: null,
      providerPaymentIntentId: null,
      providerInvoiceId: null,
      revisionNumber: 1,
    });
    const result = await correctOfflineContribution({
      organizationId: "org-1",
      contributionId: "c-orig",
      reason: "Wrong amount on the deposit slip",
      corrected: { fundId: "f1", amount: 75, method: "CHECK", contributionDate: new Date(), contributorName: "Casey Check" },
      ...actor,
    });
    expect(result.replacement.id).toBe("c-new");
    const voidCall = updateContribution.mock.calls.find((call) => call[0].where.id === "c-orig")!;
    expect(voidCall[0].data).toMatchObject({ voidReason: "Wrong amount on the deposit slip", correctedById: "c-new" });
    expect(voidCall[0].data.voidedAt).toBeInstanceOf(Date);
    const linkCall = updateContribution.mock.calls.find((call) => call[0].where.id === "c-new")!;
    expect(linkCall[0].data).toMatchObject({ correctionOfId: "c-orig", revisionNumber: 2 });
  });

  it("provider-processed rows refuse offline correction (refunds own that path)", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "c1", voidedAt: null, providerPaymentIntentId: "pi_1", providerInvoiceId: null });
    await expect(
      correctOfflineContribution({
        organizationId: "org-1",
        contributionId: "c1",
        reason: "x",
        corrected: { fundId: "f1", amount: 10, method: "CASH", contributionDate: new Date(), contributorName: "A" },
        ...actor,
      })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("reconciliation (§51) — read-only classification", () => {
  it("classifies provider-paid-but-unrecorded sessions as PROVIDER_ONLY and never writes anything", async () => {
    sessionsList.mockResolvedValueOnce({
      data: [
        {
          metadata: { organizationId: "org-1", paymentType: "giving" },
          payment_status: "paid",
          payment_intent: "pi_missing",
          amount_total: 5000,
          currency: "usd",
          created: 1_700_000_000,
        },
      ],
    });
    findFirstContribution.mockResolvedValueOnce(null);
    const report = await getReconciliationReport("org-1");
    const providerOnly = report.items.filter((item) => item.classification === "PROVIDER_ONLY");
    expect(providerOnly).toHaveLength(1);
    expect(providerOnly[0].reference).toBe("pi_missing");
    expect(createContribution).not.toHaveBeenCalled();
    expect(updateContribution).not.toHaveBeenCalled();
  });

  it("surfaces abandoned setups as UNESTRA_ONLY and failed schedules as NEEDS_REVIEW with no-debt wording", async () => {
    findManySchedules
      .mockResolvedValueOnce([{ id: "s-old", createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000), amount: 100, frequency: "MONTHLY" }])
      .mockResolvedValueOnce([{ id: "s-fail", lastAttemptAt: new Date(), failureCount: 2, fund: { name: "General Fund" } }])
      .mockResolvedValueOnce([]);
    const report = await getReconciliationReport("org-1");
    expect(report.items.some((item) => item.kind === "abandoned_recurring_setup" && item.classification === "UNESTRA_ONLY")).toBe(true);
    const failed = report.items.find((item) => item.kind === "failed_recurring_payment");
    expect(failed?.classification).toBe("NEEDS_REVIEW");
    expect(failed?.description).toMatch(/no debt accrues/);
  });

  it("a provider outage degrades gracefully — local checks still return", async () => {
    sessionsList.mockRejectedValueOnce(new Error("stripe down"));
    const report = await getReconciliationReport("org-1");
    expect(report.items.some((item) => item.kind === "provider_sweep_unavailable")).toBe(true);
  });

  describe("CONNECT-H: sweeps the org's own connected account once connected", () => {
    it("a connected/charges-enabled org is swept via the CONNECTED client, never the platform one", async () => {
      findUniqueStripeAccount.mockResolvedValueOnce({
        stripeAccountId: "acct_connected1",
        accountMode: "test",
        chargesEnabled: true,
        disabledAt: null,
      });
      connectedSessionsList.mockResolvedValueOnce({
        data: [
          {
            metadata: { organizationId: "org-1", paymentType: "giving" },
            payment_status: "paid",
            payment_intent: "pi_connected_missing",
            amount_total: 2500,
            currency: "usd",
            created: 1_700_000_000,
          },
        ],
      });
      findFirstContribution.mockResolvedValueOnce(null);
      const report = await getReconciliationReport("org-1");

      expect(sessionsList).not.toHaveBeenCalled();
      expect(invoicesList).not.toHaveBeenCalled();
      expect(connectedSessionsList.mock.calls[0][1]).toEqual({ stripeAccount: "acct_connected1" });
      const providerOnly = report.items.filter((item) => item.classification === "PROVIDER_ONLY");
      expect(providerOnly.map((item) => item.reference)).toContain("pi_connected_missing");
    });

    it("a never-connected org still sweeps the platform account (nothing new lives there, but the sweep runs)", async () => {
      findUniqueStripeAccount.mockResolvedValueOnce(null);
      await getReconciliationReport("org-1");
      expect(connectedSessionsList).not.toHaveBeenCalled();
      expect(sessionsList).toHaveBeenCalled();
    });

    it("a disabled connected account falls back to the platform sweep, not the disabled account", async () => {
      findUniqueStripeAccount.mockResolvedValueOnce({
        stripeAccountId: "acct_connected1",
        accountMode: "test",
        chargesEnabled: true,
        disabledAt: new Date(),
      });
      await getReconciliationReport("org-1");
      expect(connectedSessionsList).not.toHaveBeenCalled();
      expect(sessionsList).toHaveBeenCalled();
    });
  });
});
