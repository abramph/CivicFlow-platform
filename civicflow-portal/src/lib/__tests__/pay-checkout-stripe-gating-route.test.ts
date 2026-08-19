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

const quoteProcessingCostCoverage = vi.fn();
vi.mock("@/lib/giving/processing-cost-coverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/giving/processing-cost-coverage")>();
  return { ...actual, quoteProcessingCostCoverage: (...args: unknown[]) => quoteProcessingCostCoverage(...args) };
});

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
    quoteProcessingCostCoverage.mockReset();
    quoteProcessingCostCoverage.mockResolvedValue({ offered: true, coverageCents: 105, totalCents: 2605 });
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

describe("FEE-COVER-C: voluntary processing-cost coverage on payment links", () => {
  beforeEach(() => {
    findUniquePaymentLink.mockReset();
    findFirstPaymentLinkMethod.mockReset();
    sessionsCreate.mockReset();
    resolveConnectedAccountForCharges.mockReset();
    resolveConnectedAccountForCharges.mockResolvedValue({ stripeConnectedAccountId: "acct_connected1", accountMode: "test" });
    quoteProcessingCostCoverage.mockReset();
    quoteProcessingCostCoverage.mockResolvedValue({ offered: true, coverageCents: 105, totalCents: 2605 });
    findUniquePaymentLink.mockResolvedValue(baseLink); // $25 fixed
    findFirstPaymentLinkMethod.mockResolvedValue({ id: "plm-1" });
    sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/session-1" });
  });

  it("OFF by default: no coverage quote, unit_amount is exactly the base, split metadata records zero coverage", async () => {
    await POST(buildRequest({}), params());

    expect(quoteProcessingCostCoverage).not.toHaveBeenCalled();
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(2500);
    expect(args.metadata.linkBaseAmountCents).toBe("2500");
    expect(args.metadata.linkCoverageAmountCents).toBe("0");
  });

  it("ON: server quotes at the org's own rate, grosses the unit_amount, and snapshots the split into metadata", async () => {
    await POST(buildRequest({ coverProcessingCosts: true }), params());

    expect(quoteProcessingCostCoverage).toHaveBeenCalledWith("org-a", 2500);
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(2605);
    expect(args.metadata.linkBaseAmountCents).toBe("2500");
    expect(args.metadata.linkCoverageAmountCents).toBe("105");
  });

  it("org mode OFF: the quote returns zero coverage and the charge stays exactly the base even when the client opts in", async () => {
    quoteProcessingCostCoverage.mockResolvedValue({ offered: false, coverageCents: 0, totalCents: 2500 });

    await POST(buildRequest({ coverProcessingCosts: true }), params());

    const args = sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(2500);
    expect(args.metadata.linkCoverageAmountCents).toBe("0");
  });

  it("client-supplied fee amounts are structurally impossible: unknown fields are stripped and never reach Stripe", async () => {
    await POST(
      buildRequest({
        coverProcessingCosts: true,
        coverageCents: 1, // fake low fee
        feeAmount: -500, // negative
        totalAmount: 1, // manipulated total
        processorRate: 0.0001,
      } as never),
      params()
    );

    // Server quote wins regardless of every injected field.
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(2605);
    expect(args.metadata.linkCoverageAmountCents).toBe("105");
  });
});
