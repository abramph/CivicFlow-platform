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
      create: vi.fn().mockResolvedValue({}),
    },
    paymentLink: {
      update: vi.fn().mockResolvedValue({}),
    },
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
});
