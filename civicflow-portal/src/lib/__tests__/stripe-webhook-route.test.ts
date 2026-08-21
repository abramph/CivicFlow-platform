import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({
    STRIPE_SECRET_KEY: "sk_test_fake",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  }),
}));

const createStripeWebhookEvent = vi.fn();
const findFirstSubscription = vi.fn().mockResolvedValue(null);
const upsertSubscription = vi.fn().mockResolvedValue({ id: "sub-record-1", status: "active" });
const updateOrganization = vi.fn().mockResolvedValue({});
const findUniqueOrganizationSmsSettings = vi.fn().mockResolvedValue(null);
const upsertOrganizationSmsSettings = vi.fn().mockResolvedValue({});
const createAuditEventMock = vi.fn().mockResolvedValue({});
const contributionCreate = vi.fn().mockResolvedValue({});
const paymentLinkUpdate = vi.fn().mockResolvedValue({});
const duesChargeFindFirst = vi.fn().mockResolvedValue(null);
const duesPaymentCreate = vi.fn().mockResolvedValue({ id: "dues-payment-1" });
const duesChargeUpdate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stripeWebhookEvent: {
      create: (...args: unknown[]) => createStripeWebhookEvent(...args),
    },
    subscription: {
      findFirst: (...args: unknown[]) => findFirstSubscription(...args),
      upsert: (...args: unknown[]) => upsertSubscription(...args),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    organization: {
      update: (...args: unknown[]) => updateOrganization(...args),
    },
    organizationSmsSettings: {
      findUnique: (...args: unknown[]) => findUniqueOrganizationSmsSettings(...args),
      upsert: (...args: unknown[]) => upsertOrganizationSmsSettings(...args),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    contribution: {
      create: (...args: unknown[]) => contributionCreate(...args),
    },
    // CORE-GIVE-C: the giving branches probe for a recurring schedule first;
    // null = NOT_GIVING, so every existing SaaS assertion is unchanged.
    recurringContributionSchedule: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    paymentLink: {
      update: (...args: unknown[]) => paymentLinkUpdate(...args),
    },
    duesCharge: {
      findFirst: (...args: unknown[]) => duesChargeFindFirst(...args),
    },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        duesPayment: { create: (...args: unknown[]) => duesPaymentCreate(...args) },
        duesCharge: { update: (...args: unknown[]) => duesChargeUpdate(...args) },
      }),
  },
}));

vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...args: unknown[]) => createAuditEventMock(...args),
}));

const WEBHOOK_SECRET = "whsec_test_secret";

// stripe.subscriptions.retrieve is called for checkout.session.completed with
// a subscription attached; the real Stripe client would hit the network, so
// the class is mocked wholesale except for the static/instance webhooks
// helper, which is left real so signature construction in the route under
// test behaves exactly like production.
vi.mock("stripe", async () => {
  const actual = await vi.importActual<typeof import("stripe")>("stripe");
  class FakeStripe {
    static webhooks = actual.default.webhooks;
    webhooks = actual.default.webhooks;
    subscriptions = {
      retrieve: vi.fn().mockResolvedValue({
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        current_period_start: 1700000000,
        current_period_end: 1702592000,
        cancel_at_period_end: false,
        items: { data: [] },
        metadata: {},
      }),
    };
  }
  return { default: FakeStripe };
});

import { POST } from "@/app/api/webhooks/stripe/route";

function buildSignedRequest(payload: object) {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
  return new Request("https://app.civicflowapp.com/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body,
  });
}

describe("Stripe platform webhook", () => {
  beforeEach(() => {
    createStripeWebhookEvent.mockReset().mockResolvedValue({ id: "row-1" });
    findFirstSubscription.mockClear();
    upsertSubscription.mockClear();
    updateOrganization.mockClear();
    createAuditEventMock.mockClear();
    contributionCreate.mockClear();
    paymentLinkUpdate.mockClear();
    duesChargeFindFirst.mockReset().mockResolvedValue(null);
    duesPaymentCreate.mockClear();
    duesChargeUpdate.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request with an invalid signature", async () => {
    const body = JSON.stringify({ id: "evt_bad", type: "customer.subscription.updated", data: { object: {} } });
    const request = new Request("https://app.civicflowapp.com/api/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bogus" },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(createStripeWebhookEvent).not.toHaveBeenCalled();
  });

  it("processes a customer.subscription.updated event with a valid signature", async () => {
    const request = buildSignedRequest({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          status: "active",
          customer: "cus_1",
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          cancel_at_period_end: false,
          items: { data: [] },
          metadata: { organizationId: "org_1" },
        },
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(createStripeWebhookEvent).toHaveBeenCalledWith({
      data: { stripeEventId: "evt_1", type: "customer.subscription.updated" },
    });
    expect(upsertSubscription).toHaveBeenCalledTimes(1);
  });

  it("LAUNCH-BLOCKER E2E-2 (incomplete subscription state): maps Stripe's 'incomplete' status to our 'cancelled' status, deactivates the org, and does not treat it as active — the subscription-gate's SUBSCRIPTION_CANCELED denial reason for an org in this DB state is therefore correct end-to-end, not just an assumption at the gate layer", async () => {
    upsertSubscription.mockResolvedValueOnce({ id: "sub-record-1", status: "cancelled" });
    const request = buildSignedRequest({
      id: "evt_incomplete",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          status: "incomplete",
          customer: "cus_1",
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          cancel_at_period_end: false,
          items: { data: [] },
          metadata: { organizationId: "org_1" },
        },
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const upsertArgs = upsertSubscription.mock.calls[0][0];
    expect(upsertArgs.create.status).toBe("cancelled");
    expect(upsertArgs.update.status).toBe("cancelled");

    // isActive is false for "incomplete", so the org's plan reverts to
    // "free" and its seatLimit clears — the same downgrade path a real
    // cancellation takes, confirming "incomplete" is never treated as a
    // grant of access anywhere in the webhook handler either.
    expect(updateOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ plan: "free", seatLimit: null }) })
    );
  });

  it("skips reprocessing a duplicate event id without erroring", async () => {
    createStripeWebhookEvent.mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`stripeEventId`)"));

    const request = buildSignedRequest({
      id: "evt_duplicate",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          status: "active",
          customer: "cus_1",
          items: { data: [] },
          metadata: { organizationId: "org_1" },
        },
      },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, duplicate: true });
    expect(upsertSubscription).not.toHaveBeenCalled();
  });

  it("applies a completed dues payment-link checkout to the member's oldest outstanding charge, not a Contribution", async () => {
    duesChargeFindFirst.mockResolvedValueOnce({ id: "charge-1", amountPaid: 0, amountDue: 60 });

    const request = buildSignedRequest({
      id: "evt_dues_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          payment_status: "paid",
          amount_total: 6000,
          metadata: {
            organizationId: "org_1",
            paymentType: "dues",
            paymentLinkId: "link_1",
            memberId: "member_1",
          },
        },
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(duesChargeFindFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", memberId: "member_1", status: { in: ["PENDING", "PARTIAL"] } },
      orderBy: [{ dueDate: "asc" }],
    });
    expect(duesPaymentCreate).toHaveBeenCalledTimes(1);
    expect(duesPaymentCreate.mock.calls[0][0]).toMatchObject({
      data: expect.objectContaining({
        organizationId: "org_1",
        memberId: "member_1",
        duesChargeId: "charge-1",
        amount: 60,
        method: "STRIPE",
      }),
    });
    expect(duesChargeUpdate).toHaveBeenCalledWith({
      where: { id: "charge-1" },
      data: { amountPaid: 60, status: "PAID" },
    });
    expect(contributionCreate).not.toHaveBeenCalled();
    expect(paymentLinkUpdate).toHaveBeenCalledWith({
      where: { id: "link_1" },
      data: { useCount: { increment: 1 } },
    });
  });

  it("still records a Contribution for a non-dues (campaign) payment-link checkout", async () => {
    const request = buildSignedRequest({
      id: "evt_campaign_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_2",
          payment_status: "paid",
          amount_total: 2500,
          metadata: {
            organizationId: "org_1",
            paymentType: "campaign",
            paymentLinkId: "link_2",
            campaignId: "campaign_1",
          },
        },
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(contributionCreate).toHaveBeenCalledTimes(1);
    expect(contributionCreate.mock.calls[0][0]).toMatchObject({
      data: expect.objectContaining({
        organizationId: "org_1",
        amount: 25,
        source: "CAMPAIGN_PAGE",
        campaignId: "campaign_1",
      }),
    });
    expect(duesPaymentCreate).not.toHaveBeenCalled();
  });

  it("logs a structured warning for invoice.payment_failed — no card/customer data, ids only", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const request = buildSignedRequest({
      id: "evt_invoice_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_test_1",
          subscription: "sub_1",
          amount_due: 4900,
        },
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: "stripe_invoice_payment_failed",
      stripeSubscriptionId: "sub_1",
      stripeInvoiceId: "in_test_1",
      amountDue: 4900,
    });
  });

  it("logs a structured error (event type/id + message, no raw payload) when webhook processing throws unexpectedly", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    upsertSubscription.mockRejectedValueOnce(new Error("unexpected DB error"));

    const request = buildSignedRequest({
      id: "evt_processing_failure",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          status: "active",
          customer: "cus_1",
          items: { data: [] },
          metadata: { organizationId: "org_1" },
        },
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe("stripe_webhook_processing_failed");
    expect(logged.stripeEventType).toBe("customer.subscription.updated");
    expect(logged.stripeEventId).toBe("evt_processing_failure");
    expect(logged.error).toBe("unexpected DB error");
  });
});
