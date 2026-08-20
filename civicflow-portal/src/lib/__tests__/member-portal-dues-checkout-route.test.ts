import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ NEXTAUTH_URL: "https://app.getunestra.com" }),
}));

const requireMemberWebSession = vi.fn();
vi.mock("@/lib/member-web-session", () => ({
  requireMemberWebSession: (...args: unknown[]) => requireMemberWebSession(...args),
}));

const findActivePaymentLink = vi.fn();
vi.mock("@/lib/payment-links", () => ({
  findActivePaymentLink: (...args: unknown[]) => findActivePaymentLink(...args),
}));

const sessionsCreate = vi.fn();
const resolveConnectedAccountForCharges = vi.fn();
vi.mock("@/lib/payments/stripe-connect", () => ({
  resolveConnectedAccountForCharges: (...args: unknown[]) => resolveConnectedAccountForCharges(...args),
  getStripeForMode: async () => ({ checkout: { sessions: { create: (...args: unknown[]) => sessionsCreate(...args) } } }),
}));

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

function legacyPlan({ baseCents, payerOptedIn }: { baseCents: number; payerOptedIn: boolean }) {
  const coverageCents = payerOptedIn ? 210 : 0;
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
import { POST } from "@/app/api/member-portal/dues/checkout/route";

function buildRequest(body: object) {
  return new Request("https://app.getunestra.com/api/member-portal/dues/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/member-portal/dues/checkout", () => {
  beforeEach(() => {
    requireMemberWebSession.mockReset();
    findActivePaymentLink.mockReset();
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

  it("coverage OFF by default: base-only charge with a zero-coverage split snapshot", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce({ id: "link-1", title: "Annual Dues", amount: 60, minAmount: null });
    sessionsCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session-1" });

    await POST(buildRequest({ organizationId: "org-1" }));

    expect(resolveCoveragePlan).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", baseCents: 6000, payerOptedIn: false, nature: "FIXED_OBLIGATION" })
    );
    const call = sessionsCreate.mock.calls[0][0];
    expect(call.line_items[0].price_data.unit_amount).toBe(6000);
    expect(call.metadata.linkBaseAmountCents).toBe("6000");
    expect(call.metadata.linkCoverageAmountCents).toBe("0");
  });

  it("coverage ON: the plan grosses the charge; the base snapshot stays the dues figure that settles the obligation", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce({ id: "link-1", title: "Annual Dues", amount: 60, minAmount: null });
    sessionsCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session-1" });

    await POST(buildRequest({ organizationId: "org-1", coverProcessingCosts: true }));

    const call = sessionsCreate.mock.calls[0][0];
    expect(call.line_items[0].price_data.unit_amount).toBe(6210);
    expect(call.metadata.linkBaseAmountCents).toBe("6000");
    expect(call.metadata.linkCoverageAmountCents).toBe("210");
    expect(call.metadata.obligationAmount).toBe("6000");
    expect(call.metadata.processingCostAmount).toBe("210");
  });

  it("§7: the pending record carries the member and the obligation principal", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce({ id: "link-1", title: "Annual Dues", amount: 60, minAmount: null });
    sessionsCreate.mockResolvedValueOnce({ id: "cs_test_9", url: "https://checkout.stripe.com/session-1" });

    await POST(buildRequest({ organizationId: "org-1", coverProcessingCosts: true }));

    expect(createPendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        memberId: "member-1",
        paymentPurpose: "member-dues",
        paymentNature: "FIXED_OBLIGATION",
        obligationCents: 6000,
        processingCostCents: 210,
      })
    );
    expect(attachStripeSession).toHaveBeenCalledWith("pending-1", "cs_test_9");
  });

  it("injected client fee fields are stripped — the server plan alone determines the charge", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce({ id: "link-1", title: "Annual Dues", amount: 60, minAmount: null });
    sessionsCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session-1" });

    await POST(
      buildRequest({
        organizationId: "org-1",
        coverProcessingCosts: true,
        coverageCents: -999,
        feeAmount: 0,
        totalAmount: 1,
        paymentNature: "VOLUNTARY",
        coverageRequired: true,
        isObligation: false,
      } as never)
    );

    const call = sessionsCreate.mock.calls[0][0];
    expect(call.line_items[0].price_data.unit_amount).toBe(6210);
    expect(call.metadata.linkCoverageAmountCents).toBe("210");
    expect(resolveCoveragePlan).toHaveBeenCalledWith(expect.objectContaining({ nature: "FIXED_OBLIGATION" }));
  });

  it("returns 404 when the organization has no active DUES payment link", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce(null);

    const response = await POST(buildRequest({ organizationId: "org-1" }));

    expect(response.status).toBe(404);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("stamps the caller's own memberId (from the authenticated session, never the request body) into the Stripe session metadata", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce({
      id: "link-1",
      title: "Annual Dues",
      amount: 60,
      minAmount: null,
    });
    sessionsCreate.mockResolvedValueOnce({ url: "https://checkout.stripe.com/session-1" });

    const response = await POST(buildRequest({ organizationId: "org-1", memberId: "someone-elses-id" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, url: "https://checkout.stripe.com/session-1" });

    expect(sessionsCreate).toHaveBeenCalledTimes(1);
    const call = sessionsCreate.mock.calls[0][0];
    expect(call.metadata).toMatchObject({
      paymentType: "dues",
      paymentLinkId: "link-1",
      organizationId: "org-1",
      memberId: "member-1",
      stripeConnectedAccountId: "acct_connected1",
    });
    expect(call.line_items[0].price_data.unit_amount).toBe(6000);
    // CONNECT-E (§10/§55): the connected account, never the platform.
    expect(sessionsCreate.mock.calls[0][1]).toEqual({ stripeAccount: "acct_connected1" });
  });

  it("CONNECT-E §14/§55: an org without a connected/charges-enabled account gets a clean error, never a platform fallback", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce({ id: "link-1", title: "Annual Dues", amount: 60, minAmount: null });
    resolveConnectedAccountForCharges.mockRejectedValueOnce(
      new FinanceError("Payments are not set up for this organization yet.", 409)
    );

    const response = await POST(buildRequest({ organizationId: "org-1" }));

    expect(response.status).toBe(409);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("rejects a custom amount below the payment link's configured minimum", async () => {
    requireMemberWebSession.mockResolvedValueOnce({ organizationId: "org-1", memberId: "member-1" });
    findActivePaymentLink.mockResolvedValueOnce({
      id: "link-1",
      title: "Dues (any amount)",
      amount: null,
      minAmount: 25,
    });

    const response = await POST(buildRequest({ organizationId: "org-1", amount: 10 }));

    expect(response.status).toBe(400);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
