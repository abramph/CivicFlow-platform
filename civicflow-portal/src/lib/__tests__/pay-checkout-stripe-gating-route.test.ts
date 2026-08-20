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

// COST-POLICY v2: the route resolves coverage through the policy engine
// and persists a first-party pending record before redirecting.
const resolveCoveragePlan = vi.fn();
vi.mock("@/lib/payments/cost-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/cost-policy")>();
  return { ...actual, resolveCoveragePlan: (...args: unknown[]) => resolveCoveragePlan(...args) };
});
const createPendingPayment = vi.fn();
const attachStripeSession = vi.fn();
vi.mock("@/lib/payments/pending-payments", () => ({
  createPendingPayment: (...args: unknown[]) => createPendingPayment(...args),
  attachStripeSession: (...args: unknown[]) => attachStripeSession(...args),
}));

/** Legacy-parity plan: optional coverage, quoted only when the payer opted
 * in — the same behavior the old quote mock produced. */
function legacyPlan({ baseCents, payerOptedIn }: { baseCents: number; payerOptedIn: boolean }) {
  const coverageCents = payerOptedIn ? 105 : 0;
  return {
    offered: true,
    required: false,
    coverageCents,
    totalCents: baseCents + coverageCents,
    coverageMode: payerOptedIn ? "LEGACY_OPTIONAL" : "NONE",
    restrictToPaymentMethods: null,
    fallbackMessage: null,
    policyVersion: null,
  };
}

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
    resolveCoveragePlan.mockReset();
    resolveCoveragePlan.mockImplementation(async (args: { baseCents: number; payerOptedIn: boolean }) => legacyPlan(args));
    createPendingPayment.mockReset();
    createPendingPayment.mockResolvedValue({ id: "pending-1", idempotencyReference: "idem-1" });
    attachStripeSession.mockReset();
    attachStripeSession.mockResolvedValue(undefined);
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

describe("FEE-COVER-C / COST-POLICY: processing-cost coverage on payment links", () => {
  beforeEach(() => {
    findUniquePaymentLink.mockReset();
    findFirstPaymentLinkMethod.mockReset();
    sessionsCreate.mockReset();
    resolveConnectedAccountForCharges.mockReset();
    resolveConnectedAccountForCharges.mockResolvedValue({ stripeConnectedAccountId: "acct_connected1", accountMode: "test" });
    resolveCoveragePlan.mockReset();
    resolveCoveragePlan.mockImplementation(async (args: { baseCents: number; payerOptedIn: boolean }) => legacyPlan(args));
    createPendingPayment.mockReset();
    createPendingPayment.mockResolvedValue({ id: "pending-1", idempotencyReference: "idem-1" });
    attachStripeSession.mockReset();
    attachStripeSession.mockResolvedValue(undefined);
    findUniquePaymentLink.mockResolvedValue(baseLink); // $25 fixed
    findFirstPaymentLinkMethod.mockResolvedValue({ id: "plm-1" });
    sessionsCreate.mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/session-1" });
  });

  it("OFF by default: unit_amount is exactly the base, split metadata records zero coverage", async () => {
    await POST(buildRequest({}), params());

    expect(resolveCoveragePlan).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", baseCents: 2500, payerOptedIn: false })
    );
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(2500);
    expect(args.metadata.linkBaseAmountCents).toBe("2500");
    expect(args.metadata.linkCoverageAmountCents).toBe("0");
  });

  it("ON: the policy engine grosses the unit_amount and the split is snapshotted into metadata", async () => {
    await POST(buildRequest({ coverProcessingCosts: true }), params());

    expect(resolveCoveragePlan).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", baseCents: 2500, payerOptedIn: true })
    );
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(2605);
    expect(args.metadata.linkBaseAmountCents).toBe("2500");
    expect(args.metadata.linkCoverageAmountCents).toBe("105");
  });

  it("org policy gives no coverage: the charge stays exactly the base even when the client opts in", async () => {
    resolveCoveragePlan.mockResolvedValue({
      offered: false,
      required: false,
      coverageCents: 0,
      totalCents: 2500,
      coverageMode: "V2_ORGANIZATION_ABSORBED",
      restrictToPaymentMethods: null,
      fallbackMessage: null,
      policyVersion: "v2.0",
    });

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
        paymentNature: "OFFLINE", // §3: server-derived, never client-supplied
        coverageRequired: false,
        isObligation: false,
        amountCredited: 1,
      } as never),
      params()
    );

    // Server plan wins regardless of every injected field.
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.line_items[0].price_data.unit_amount).toBe(2605);
    expect(args.metadata.linkCoverageAmountCents).toBe("105");
    // Nature was derived server-side (dues-type link → FIXED_OBLIGATION).
    expect(resolveCoveragePlan).toHaveBeenCalledWith(expect.objectContaining({ nature: "FIXED_OBLIGATION" }));
  });

  it("§7: a PendingPayment is persisted before redirect and the session id is attached", async () => {
    await POST(buildRequest({ coverProcessingCosts: true }), params());

    expect(createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-a",
        paymentLinkId: "link-1",
        obligationCents: 2500,
        processingCostCents: 105,
        stripeConnectedAccountId: "acct_connected1",
      })
    );
    expect(attachStripeSession).toHaveBeenCalledWith("pending-1", "cs_test_1");
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.metadata.pendingPaymentId).toBe("pending-1");
    expect(args.metadata.idempotencyReference).toBe("idem-1");
    expect(args.metadata.obligationAmount).toBe("2500");
    expect(args.metadata.processingCostAmount).toBe("105");
  });
});
