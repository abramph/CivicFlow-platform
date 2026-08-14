import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstSchedule = vi.fn();
const updateScheduleRow = vi.fn();
const findUniqueUser = vi.fn();
const subscriptionItemsUpdate = vi.fn();
const subscriptionsUpdate = vi.fn();
const subscriptionsCancel = vi.fn();
const subscriptionsRetrieve = vi.fn();
const invoicesList = vi.fn();
const invoicesPay = vi.fn();
const setupIntentsRetrieve = vi.fn();
const paymentMethodsRetrieve = vi.fn();
const sendEmail = vi.fn().mockResolvedValue({ sent: true });
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recurringContributionSchedule: {
      findFirst: (...a: unknown[]) => findFirstSchedule(...a),
      update: (...a: unknown[]) => updateScheduleRow(...a),
    },
    user: { findUnique: (...a: unknown[]) => findUniqueUser(...a) },
  },
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptionItems: { update: (...a: unknown[]) => subscriptionItemsUpdate(...a) },
    subscriptions: {
      update: (...a: unknown[]) => subscriptionsUpdate(...a),
      cancel: (...a: unknown[]) => subscriptionsCancel(...a),
      retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a),
    },
    invoices: { list: (...a: unknown[]) => invoicesList(...a), pay: (...a: unknown[]) => invoicesPay(...a) },
    setupIntents: { retrieve: (...a: unknown[]) => setupIntentsRetrieve(...a) },
    paymentMethods: { retrieve: (...a: unknown[]) => paymentMethodsRetrieve(...a) },
    checkout: { sessions: { create: vi.fn() } },
  }),
}));
vi.mock("@/lib/mail", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import {
  applyPaymentMethodUpdate,
  cancelSchedule,
  changeAmount,
  changeFrequency,
  pauseSchedule,
  resumeSchedule,
  retryFailedPayment,
} from "@/lib/giving/recurring-self-service";

const ownSchedule = {
  id: "s1",
  organizationId: "org-1",
  contributorUserId: "u1",
  providerSubscriptionId: "sub_1",
  providerCustomerId: "cus_1",
  status: "ACTIVE",
  amount: 100,
  frequency: "MONTHLY",
  fund: { name: "General Fund" },
};

const caller = { organizationId: "org-1", contributorUserId: "u1", scheduleId: "s1" };

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueUser.mockResolvedValue({ email: "member@example.org" });
  updateScheduleRow.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...ownSchedule, ...args.data }));
  subscriptionsRetrieve.mockResolvedValue({ items: { data: [{ id: "si_1", price: { product: "prod_1" } }] }, current_period_end: 1_900_000_000 });
});

describe("ownership (§111.5)", () => {
  it("another member's schedule is a 404 — the query itself carries the contributor", async () => {
    findFirstSchedule.mockResolvedValueOnce(null);
    await expect(changeAmount({ ...caller, scheduleId: "someone-elses", newAmount: 50 })).rejects.toMatchObject({ status: 404 });
    expect(findFirstSchedule.mock.calls[0][0].where).toMatchObject({
      id: "someone-elses",
      organizationId: "org-1",
      contributorUserId: "u1",
    });
    expect(subscriptionItemsUpdate).not.toHaveBeenCalled();
  });
});

describe("change amount (§12)", () => {
  it("provider first with proration none, then the row, audit carries old/new", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    await changeAmount({ ...caller, newAmount: 75 });
    expect(subscriptionItemsUpdate.mock.calls[0][1]).toMatchObject({ proration_behavior: "none" });
    expect(subscriptionItemsUpdate.mock.calls[0][1].price_data.unit_amount).toBe(7500);
    expect(updateScheduleRow).toHaveBeenCalled();
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "giving.recurring_amount_changed",
        metadata: expect.objectContaining({ oldAmount: 100, newAmount: 75 }),
      })
    );
    expect(sendEmail).toHaveBeenCalled();
  });

  it("a provider failure changes nothing locally", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    subscriptionItemsUpdate.mockRejectedValueOnce(new Error("stripe down"));
    await expect(changeAmount({ ...caller, newAmount: 75 })).rejects.toThrow();
    expect(updateScheduleRow).not.toHaveBeenCalled();
  });

  it("cancelled schedules refuse changes", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "CANCELLED" });
    await expect(changeAmount({ ...caller, newAmount: 75 })).rejects.toMatchObject({ status: 409 });
  });
});

describe("change frequency (§13)", () => {
  it("keeps the amount, swaps the interval, proration none", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    await changeFrequency({ ...caller, newFrequency: "WEEKLY" });
    const args = subscriptionItemsUpdate.mock.calls[0][1];
    expect(args.price_data.recurring).toEqual({ interval: "week", interval_count: 1 });
    expect(args.price_data.unit_amount).toBe(10000);
    expect(args.proration_behavior).toBe("none");
  });
});

describe("pause / resume (§14)", () => {
  it("pause voids collection and touches nothing but the schedule — no debt anywhere", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    await pauseSchedule(caller);
    expect(subscriptionsUpdate.mock.calls[0][1]).toEqual({ pause_collection: { behavior: "void" } });
    expect(updateScheduleRow.mock.calls[0][0].data).toMatchObject({ status: "PAUSED" });
  });

  it("resume clears the pause and reads the REAL next date from the provider", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "PAUSED" });
    subscriptionsUpdate.mockResolvedValueOnce({ current_period_end: 1_900_000_000 });
    await resumeSchedule(caller);
    expect(subscriptionsUpdate.mock.calls[0][1]).toEqual({ pause_collection: null });
    expect(updateScheduleRow.mock.calls[0][0].data.status).toBe("ACTIVE");
    expect(updateScheduleRow.mock.calls[0][0].data.nextContributionDate).toEqual(new Date(1_900_000_000 * 1000));
  });

  it("only paused schedules resume; only live schedules pause", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "ACTIVE" });
    await expect(resumeSchedule(caller)).rejects.toMatchObject({ status: 409 });
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "CANCELLED" });
    await expect(pauseSchedule(caller)).rejects.toMatchObject({ status: 409 });
  });
});

describe("cancel (§15/§112)", () => {
  it("provider cancel, terminal row, optional reason, history untouched — and idempotent", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    await cancelSchedule({ ...caller, reason: "prefer_manual_giving" });
    expect(subscriptionsCancel).toHaveBeenCalledWith("sub_1");
    expect(updateScheduleRow.mock.calls[0][0].data).toMatchObject({ status: "CANCELLED", cancelReason: "prefer_manual_giving" });

    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "CANCELLED" });
    await cancelSchedule({ ...caller });
    expect(subscriptionsCancel).toHaveBeenCalledTimes(1);
  });

  it("unknown reasons are rejected; no reason is required", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    await expect(cancelSchedule({ ...caller, reason: "because" })).rejects.toMatchObject({ name: "FinanceError" });
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    await expect(cancelSchedule({ ...caller })).resolves.toBeTruthy();
  });
});

describe("retry (§16/§17)", () => {
  it("pays only the schedule's own latest OPEN invoice, only from a failed state", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "PAYMENT_FAILED" });
    invoicesList.mockResolvedValueOnce({ data: [{ id: "in_open" }] });
    await retryFailedPayment(caller);
    expect(invoicesList.mock.calls[0][0]).toMatchObject({ subscription: "sub_1", status: "open" });
    expect(invoicesPay).toHaveBeenCalledWith("in_open");

    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "ACTIVE" });
    await expect(retryFailedPayment(caller)).rejects.toMatchObject({ status: 409 });
  });

  it("failure copy never implies debt", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule, status: "PAYMENT_FAILED" });
    invoicesList.mockResolvedValueOnce({ data: [{ id: "in_open" }] });
    invoicesPay.mockRejectedValueOnce(new Error("card_declined"));
    await expect(retryFailedPayment(caller)).rejects.toMatchObject({
      message: expect.not.stringMatching(/owe|debt|balance due/i),
    });
  });
});

describe("payment method update webhook (§8)", () => {
  it("applies the setup intent's method as subscription default and stores a safe descriptor only", async () => {
    findFirstSchedule.mockResolvedValueOnce({ ...ownSchedule });
    setupIntentsRetrieve.mockResolvedValueOnce({ payment_method: "pm_new" });
    paymentMethodsRetrieve.mockResolvedValueOnce({ type: "card", card: { brand: "visa", last4: "4242" } });
    const result = await applyPaymentMethodUpdate({ organizationId: "org-1", scheduleId: "s1", setupIntentId: "seti_1" });
    expect(result).toBe("APPLIED");
    expect(subscriptionsUpdate.mock.calls[0][1]).toEqual({ default_payment_method: "pm_new" });
    expect(updateScheduleRow.mock.calls[0][0].data).toMatchObject({
      providerPaymentMethodId: "pm_new",
      paymentMethodDescriptor: "VISA •••• 4242",
    });
  });

  it("org-mismatched schedules are REJECTED and nothing is touched (§50)", async () => {
    findFirstSchedule.mockResolvedValueOnce(null);
    const result = await applyPaymentMethodUpdate({ organizationId: "org-1", scheduleId: "foreign", setupIntentId: "seti_1" });
    expect(result).toBe("REJECTED");
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });
});
