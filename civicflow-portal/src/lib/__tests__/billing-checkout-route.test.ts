import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unestra Cloud (CLOUD-D). No test existed for this route before this
 * program — the audit flagged it as a real gap. Covers the core server-
 * authority guarantee: the client sends only a billing interval, never a
 * plan/vertical/price, and the server resolves the plan entirely from the
 * organization's own primaryVertical (see route.ts's doc comment).
 */

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ NEXTAUTH_URL: "https://app.getunestra.com" }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const findUniqueOrganization = vi.fn();
const findFirstSubscription = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    subscription: { findFirst: (...args: unknown[]) => findFirstSubscription(...args) },
  },
}));

const getOrCreateStripeCustomer = vi.fn();
const createCheckoutSession = vi.fn();
const priceIdForPlan = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getOrCreateStripeCustomer: (...args: unknown[]) => getOrCreateStripeCustomer(...args),
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  priceIdForPlan: (...args: unknown[]) => priceIdForPlan(...args),
}));

import { POST } from "@/app/api/billing/checkout/route";

function buildRequest(body: object) {
  return new Request("https://app.getunestra.com/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/checkout — server-authoritative plan resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ organizationId: "org-1" });
    findFirstSubscription.mockResolvedValue(null);
    getOrCreateStripeCustomer.mockResolvedValue("cus_123");
    createCheckoutSession.mockResolvedValue("https://checkout.stripe.com/session_abc");
    priceIdForPlan.mockReturnValue("price_resolved");
  });

  it("resolves the plan from the organization's own primaryVertical — the client never sends a plan id at all", async () => {
    findUniqueOrganization.mockResolvedValue({ name: "Union Local 400", email: "a@b.com", plan: "free", primaryVertical: "UNION" });

    const res = await POST(buildRequest({ interval: "month" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plan).toBe("union_monthly");
    expect(priceIdForPlan).toHaveBeenCalledWith("union_monthly");
  });

  it("ignores a client-supplied plan/vertical field entirely — it has no effect on the resolved plan", async () => {
    findUniqueOrganization.mockResolvedValue({ name: "PTA Org", email: "a@b.com", plan: "free", primaryVertical: "PTA" });

    // Attempted spoof: claims UNION pricing and a specific price id via
    // extra, unrecognized body fields. The schema strips unknown keys, so
    // this has zero effect on the resolved plan.
    const res = await POST(
      buildRequest({ interval: "month", plan: "union_monthly", vertical: "UNION", priceId: "price_cheap_hack" } as never)
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plan).toBe("pta_monthly");
    expect(priceIdForPlan).toHaveBeenCalledWith("pta_monthly");
  });

  it("maps an HOA org onto community pricing, not a separate HOA plan", async () => {
    findUniqueOrganization.mockResolvedValue({ name: "Oak Ridge HOA", email: "a@b.com", plan: "free", primaryVertical: "HOA" });

    const res = await POST(buildRequest({ interval: "year" }));
    const data = await res.json();

    expect(data.plan).toBe("community_annual");
  });

  it("defaults to monthly when no interval is supplied", async () => {
    findUniqueOrganization.mockResolvedValue({ name: "Church Org", email: "a@b.com", plan: "free", primaryVertical: "CHURCH" });

    const res = await POST(buildRequest({}));
    const data = await res.json();

    expect(data.plan).toBe("church_monthly");
  });

  it("refuses to create a second checkout session for an org with an active subscription", async () => {
    findUniqueOrganization.mockResolvedValue({ name: "Org", email: "a@b.com", plan: "pta_monthly", primaryVertical: "PTA" });
    findFirstSubscription.mockResolvedValue({ id: "sub-1" });

    const res = await POST(buildRequest({ interval: "month" }));
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("refuses when the org is already on the resolved plan", async () => {
    findUniqueOrganization.mockResolvedValue({ name: "Org", email: "a@b.com", plan: "pta_monthly", primaryVertical: "PTA" });

    const res = await POST(buildRequest({ interval: "month" }));
    expect(res.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("404s for an organization that doesn't exist", async () => {
    findUniqueOrganization.mockResolvedValue(null);
    const res = await POST(buildRequest({ interval: "month" }));
    expect(res.status).toBe(404);
  });

  it("when Stripe throws (e.g. a price/mode mismatch), returns a safe message + reference id and never leaks the raw price id", async () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error -- NODE_ENV is readonly in the type; standard pattern
    // here for exercising the prod-only sanitized-message branch under test.
    process.env.NODE_ENV = "production";
    try {
      findUniqueOrganization.mockResolvedValue({ name: "Union Local 400", email: "a@b.com", plan: "free", primaryVertical: "UNION" });
      priceIdForPlan.mockReturnValue("price_1LiveSecretLookingId");
      createCheckoutSession.mockRejectedValueOnce(
        new Error(
          "No such price: 'price_1LiveSecretLookingId'; a similar object exists in live mode, but a test mode key was used to make this request."
        )
      );

      const res = await POST(buildRequest({ interval: "month" }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(typeof body.referenceId).toBe("string");
      expect(body.referenceId).toHaveLength(8);
      expect(JSON.stringify(body)).not.toContain("price_1LiveSecretLookingId");
      expect(JSON.stringify(body)).not.toContain("test mode key");
    } finally {
      // @ts-expect-error -- restoring the same readonly-typed property
      process.env.NODE_ENV = originalEnv;
    }
  });
});

describe("CLOUD-I: administrative seats are never a paid checkout add-on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermission.mockResolvedValue({ organizationId: "org-1" });
    findFirstSubscription.mockResolvedValue(null);
    getOrCreateStripeCustomer.mockResolvedValue("cus_123");
    createCheckoutSession.mockResolvedValue("https://checkout.stripe.com/session_abc");
    priceIdForPlan.mockReturnValue("price_resolved");
    findUniqueOrganization.mockResolvedValue({ name: "PTA Org", email: "a@b.com", plan: "free", primaryVertical: "PTA" });
  });

  it("a client-supplied additionalSeats field is silently stripped — the schema has no such field at all", async () => {
    const res = await POST(buildRequest({ interval: "month", additionalSeats: 25 } as never));
    expect(res.status).toBe(200);
    // createCheckoutSession is called with exactly the base-plan args — no
    // seatPriceId, no additionalSeats — regardless of what the client sent.
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ seatPriceId: expect.anything(), additionalSeats: expect.anything() })
    );
  });

  it("creates a checkout session with only organizationId/stripeCustomerId/priceId/successUrl/cancelUrl", async () => {
    await POST(buildRequest({ interval: "year" }));
    const callArgs = createCheckoutSession.mock.calls[0][0];
    expect(Object.keys(callArgs).sort()).toEqual(
      ["organizationId", "stripeCustomerId", "priceId", "successUrl", "cancelUrl"].sort()
    );
  });
});
