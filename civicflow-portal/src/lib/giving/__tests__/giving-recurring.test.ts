import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrgSettings = vi.fn();
const findFirstFund = vi.fn();
const findFirstProgram = vi.fn();
const findFirstSchedule = vi.fn();
const findUniqueSchedule = vi.fn();
const createSchedule = vi.fn();
const updateSchedule = vi.fn();
const findFirstContribution = vi.fn();
const createContribution = vi.fn();
const countContributions = vi.fn();
const saasSubscriptionUpsert = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueOrgSettings(...a) },
    fund: { findFirst: (...a: unknown[]) => findFirstFund(...a) },
    contributionProgram: { findFirst: (...a: unknown[]) => findFirstProgram(...a) },
    recurringContributionSchedule: {
      findFirst: (...a: unknown[]) => findFirstSchedule(...a),
      findUnique: (...a: unknown[]) => findUniqueSchedule(...a),
      findMany: vi.fn().mockResolvedValue([]),
      create: (...a: unknown[]) => createSchedule(...a),
      update: (...a: unknown[]) => updateSchedule(...a),
    },
    contribution: {
      findFirst: (...a: unknown[]) => findFirstContribution(...a),
      create: (...a: unknown[]) => createContribution(...a),
      count: (...a: unknown[]) => countContributions(...a),
    },
    subscription: { upsert: (...a: unknown[]) => saasSubscriptionUpsert(...a), updateMany: (...a: unknown[]) => saasSubscriptionUpsert(...a) },
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { stripeIntervalFor } from "@/lib/giving/giving-stripe";
import {
  createPendingSchedule,
  linkScheduleFromCheckout,
  markRecurringInvoiceFailed,
  recordRecurringInvoicePaid,
  syncScheduleFromSubscription,
  validateRecurringRequest,
} from "@/lib/giving/recurring";

const baseRequest = {
  organizationId: "org-1",
  fundId: "f1",
  amount: 100,
  frequency: "MONTHLY" as const,
  contributorUserId: "u1",
};

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueOrgSettings.mockResolvedValue({ contributionsEnabled: true });
  countContributions.mockResolvedValue(0);
  createContribution.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "c1", ...args.data }));
  createSchedule.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "s1", ...args.data }));
});

describe("frequency mapping (§9)", () => {
  it("maps every supported frequency to the right Stripe interval", () => {
    expect(stripeIntervalFor("WEEKLY")).toEqual({ interval: "week", interval_count: 1 });
    expect(stripeIntervalFor("BIWEEKLY")).toEqual({ interval: "week", interval_count: 2 });
    expect(stripeIntervalFor("MONTHLY")).toEqual({ interval: "month", interval_count: 1 });
    expect(stripeIntervalFor("QUARTERLY")).toEqual({ interval: "month", interval_count: 3 });
    expect(stripeIntervalFor("ANNUALLY")).toEqual({ interval: "year", interval_count: 1 });
  });
});

describe("validateRecurringRequest", () => {
  it("requires the fund to accept recurring giving", async () => {
    findFirstFund.mockResolvedValueOnce({ id: "f1", name: "One-time only", status: "ACTIVE", allowRecurring: false });
    await expect(validateRecurringRequest(baseRequest)).rejects.toMatchObject({ status: 409 });
  });

  it("§92 duplicate guard: same fund+frequency live schedule 409s unless explicitly confirmed", async () => {
    findFirstFund.mockResolvedValue({ id: "f1", name: "General", status: "ACTIVE", allowRecurring: true, minimumAmount: null, maximumAmount: null });
    findFirstSchedule.mockResolvedValueOnce({ id: "existing" });
    await expect(validateRecurringRequest(baseRequest)).rejects.toMatchObject({ status: 409 });

    findFirstSchedule.mockResolvedValueOnce(null);
    await expect(validateRecurringRequest({ ...baseRequest, confirmDuplicate: true })).resolves.toBeTruthy();
    // confirmDuplicate skips the duplicate query entirely
    expect(findFirstSchedule).toHaveBeenCalledTimes(1);
  });

  it("program frequency whitelists are honored", async () => {
    findFirstFund.mockResolvedValue({ id: "f1", name: "General", status: "ACTIVE", allowRecurring: true, minimumAmount: null, maximumAmount: null });
    findFirstProgram.mockResolvedValueOnce({ id: "p1", fundId: "f1", status: "ACTIVE", allowedFrequencies: ["MONTHLY"], name: "Monthly Only" });
    findFirstSchedule.mockResolvedValueOnce(null);
    await expect(
      validateRecurringRequest({ ...baseRequest, frequency: "WEEKLY", programId: "p1" })
    ).rejects.toMatchObject({ name: "FinanceError" });
  });

  it("pending schedules are created VOLUNTARY-shaped: USD, PENDING_SETUP, audit trail", async () => {
    findFirstFund.mockResolvedValue({ id: "f1", name: "General", status: "ACTIVE", allowRecurring: true, minimumAmount: null, maximumAmount: null });
    findFirstSchedule.mockResolvedValueOnce(null);
    const { schedule } = await createPendingSchedule({ ...baseRequest, memberId: "m1" });
    expect(schedule).toMatchObject({ status: "PENDING_SETUP", currency: "USD" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "giving.recurring_setup_started" }));
  });
});

describe("webhook lifecycle — the SaaS/giving split", () => {
  it("checkout linkage is org-scoped (§50): foreign schedule id is REJECTED", async () => {
    findFirstSchedule.mockResolvedValueOnce(null);
    const result = await linkScheduleFromCheckout({
      scheduleId: "foreign",
      organizationId: "org-1",
      providerSubscriptionId: "sub_1",
      providerCustomerId: "cus_1",
    });
    expect(result).toBe("REJECTED");
    expect(updateSchedule).not.toHaveBeenCalled();
  });

  it("CONNECT-D §56: linkage stamps the connected account immutably when provided", async () => {
    // mockReset (not just mockResolvedValueOnce) guards against unconsumed
    // once-queue leftovers from earlier tests in this file that skip their
    // own findFirst call under certain branches.
    findFirstSchedule.mockReset();
    findFirstSchedule.mockResolvedValueOnce({ id: "s1", status: "PENDING_SETUP" });
    await linkScheduleFromCheckout({
      scheduleId: "s1",
      organizationId: "org-1",
      providerSubscriptionId: "sub_1",
      providerCustomerId: "cus_1",
      stripeConnectedAccountId: "acct_connected1",
    });
    expect(updateSchedule.mock.calls[0][0].data).toMatchObject({
      stripeConnectedAccountId: "acct_connected1",
      providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
    });
  });

  it("invoice.paid records an idempotent contribution and advances the schedule — and never touches the SaaS Subscription table", async () => {
    findUniqueSchedule.mockResolvedValueOnce({
      id: "s1",
      organizationId: "org-1",
      fundId: "f1",
      contributionProgramId: null,
      memberId: "m1",
      contributorUserId: "u1",
      contributionProgram: null,
      stripeConnectedAccountId: "acct_connected1",
      providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
    });
    findFirstContribution.mockResolvedValueOnce(null);
    const result = await recordRecurringInvoicePaid({
      providerSubscriptionId: "sub_1",
      providerInvoiceId: "in_1",
      amountPaidCents: 10000,
      currency: "usd",
      periodEnd: 1_900_000_000,
      paymentIntentId: "pi_9",
    });
    expect(result.outcome).toBe("RECORDED");
    expect(createContribution.mock.calls[0][0].data).toMatchObject({
      recurringScheduleId: "s1",
      providerInvoiceId: "in_1",
      amount: 100,
      // CONNECT-D (§56): attribution comes from the schedule's own stamp.
      stripeConnectedAccountId: "acct_connected1",
      providerAccountContext: "CONNECTED_ACCOUNT_PAYMENT",
    });
    expect(updateSchedule.mock.calls[0][0].data).toMatchObject({ status: "ACTIVE", failureCount: 0 });
    expect(saasSubscriptionUpsert).not.toHaveBeenCalled();

    // Same invoice again → DUPLICATE, no second row.
    findUniqueSchedule.mockResolvedValueOnce({ id: "s1", organizationId: "org-1", contributionProgram: null });
    findFirstContribution.mockResolvedValueOnce({ id: "c1" });
    const second = await recordRecurringInvoicePaid({
      providerSubscriptionId: "sub_1",
      providerInvoiceId: "in_1",
      amountPaidCents: 10000,
      currency: "usd",
      periodEnd: null,
      paymentIntentId: null,
    });
    expect(second.outcome).toBe("DUPLICATE");
    expect(createContribution).toHaveBeenCalledTimes(1);
  });

  it("an unknown subscription id is NOT_GIVING — the SaaS path handles it, we record nothing", async () => {
    findUniqueSchedule.mockResolvedValueOnce(null);
    const result = await recordRecurringInvoicePaid({
      providerSubscriptionId: "sub_saas",
      providerInvoiceId: "in_2",
      amountPaidCents: 4900,
      currency: "usd",
      periodEnd: null,
      paymentIntentId: null,
    });
    expect(result.outcome).toBe("NOT_GIVING");
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("§16/§112: payment failure sets schedule state and NEVER creates debt — no dues, no arrears, just status + count", async () => {
    findUniqueSchedule.mockResolvedValueOnce({ id: "s1", organizationId: "org-1", contributorUserId: "u1" });
    const result = await markRecurringInvoiceFailed({ providerSubscriptionId: "sub_1", requiresAction: false });
    expect(result).toBe("MARKED");
    expect(updateSchedule.mock.calls[0][0].data).toMatchObject({ status: "PAYMENT_FAILED", failureCount: { increment: 1 } });
    expect(createContribution).not.toHaveBeenCalled();
    expect(saasSubscriptionUpsert).not.toHaveBeenCalled();
  });

  it("provider-side cancellation mirrors CANCELLED with history preserved", async () => {
    findUniqueSchedule.mockResolvedValueOnce({ id: "s1", organizationId: "org-1", contributorUserId: "u1", status: "ACTIVE", pausedAt: null });
    const result = await syncScheduleFromSubscription({
      providerSubscriptionId: "sub_1",
      providerStatus: "canceled",
      cancelAtPeriodEnd: false,
      deleted: true,
    });
    expect(result).toBe("SYNCED");
    expect(updateSchedule.mock.calls[0][0].data).toMatchObject({ status: "CANCELLED" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "giving.recurring_cancelled" }));
  });
});
