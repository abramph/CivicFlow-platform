import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ NEXTAUTH_URL: "https://app.getunestra.com" }) }));

const findUniquePaymentLink = vi.fn();
const findFirstPaymentLinkMethod = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentLink: { findUnique: (...args: unknown[]) => findUniquePaymentLink(...args) },
    paymentLinkMethod: { findFirst: (...args: unknown[]) => findFirstPaymentLinkMethod(...args) },
  },
}));

const sessionsCreate = vi.fn();
const resolveConnectedAccountForCharges = vi.fn();
vi.mock("@/lib/payments/stripe-connect", () => ({
  resolveConnectedAccountForCharges: (...args: unknown[]) => resolveConnectedAccountForCharges(...args),
  getStripeForMode: async () => ({ checkout: { sessions: { create: (...args: unknown[]) => sessionsCreate(...args) } } }),
}));

import { FinanceError } from "@/lib/finance-errors";
import { POST } from "@/app/api/pay/[slug]/checkout/route";

function buildRequest(body: object) {
  return new Request("https://app.getunestra.com/api/pay/annual-fund-abc123/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(slug = "annual-fund-abc123") {
  return { params: Promise.resolve({ slug }) };
}

const baseLink = {
  id: "link-1",
  organizationId: "org-a",
  slug: "annual-fund-abc123",
  title: "Annual Fund",
  status: "active",
  expiresAt: null,
  amount: 25,
  minAmount: null,
  campaignId: null,
  eventId: null,
  campaign: null,
  event: null,
  organization: { id: "org-a", name: "Oak Ridge HOA" },
};

describe("POST /api/pay/[slug]/checkout (Stripe gating)", () => {
  beforeEach(() => {
    findUniquePaymentLink.mockReset();
    findFirstPaymentLinkMethod.mockReset();
    sessionsCreate.mockReset();
    resolveConnectedAccountForCharges.mockReset();
    resolveConnectedAccountForCharges.mockResolvedValue({ stripeConnectedAccountId: "acct_connected1", accountMode: "test" });
  });

  it("rejects checkout when the link has no active STRIPE PaymentLinkMethod attached", async () => {
    findUniquePaymentLink.mockResolvedValueOnce(baseLink);
    findFirstPaymentLinkMethod.mockResolvedValueOnce(null);

    const response = await POST(buildRequest({}), params());

    expect(response.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("proceeds to create a Stripe Checkout session when the link has an active STRIPE method", async () => {
    findUniquePaymentLink.mockResolvedValueOnce(baseLink);
    findFirstPaymentLinkMethod.mockResolvedValueOnce({ id: "plm-1" });
    sessionsCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session-1" });

    const response = await POST(buildRequest({}), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, url: "https://checkout.stripe.com/session-1" });
    expect(findFirstPaymentLinkMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentLinkId: "link-1", paymentMethodConfig: { method: "STRIPE", isActive: true } },
      })
    );
    // CONNECT-E (§10/§55): the connected account, never the platform.
    expect(sessionsCreate.mock.calls[0][1]).toEqual({ stripeAccount: "acct_connected1" });
  });

  it("CONNECT-E §14/§55: an org without a connected/charges-enabled account gets a clean error, never a platform fallback", async () => {
    findUniquePaymentLink.mockResolvedValueOnce(baseLink);
    findFirstPaymentLinkMethod.mockResolvedValueOnce({ id: "plm-1" });
    resolveConnectedAccountForCharges.mockRejectedValueOnce(
      new FinanceError("Payments are not set up for this organization yet.", 409)
    );

    const response = await POST(buildRequest({}), params());

    expect(response.status).toBe(409);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
