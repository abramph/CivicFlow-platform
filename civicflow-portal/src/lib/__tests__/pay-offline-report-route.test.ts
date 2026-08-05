import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const findUniquePaymentLink = vi.fn();
const findFirstPaymentLinkMethod = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentLink: { findUnique: (...args: unknown[]) => findUniquePaymentLink(...args) },
    paymentLinkMethod: { findFirst: (...args: unknown[]) => findFirstPaymentLinkMethod(...args) },
  },
}));

const createPaymentLinkOfflineReportAndNotify = vi.fn();
vi.mock("@/lib/payment-link-offline-reports", () => ({
  createPaymentLinkOfflineReportAndNotify: (...args: unknown[]) => createPaymentLinkOfflineReportAndNotify(...args),
}));

import { POST } from "@/app/api/pay/[slug]/offline-report/route";

function buildRequest(body: object) {
  return new Request("https://app.getunestra.com/api/pay/annual-fund-abc123/offline-report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function params(slug = "annual-fund-abc123") {
  return { params: Promise.resolve({ slug }) };
}

describe("POST /api/pay/[slug]/offline-report", () => {
  beforeEach(() => {
    findUniquePaymentLink.mockReset();
    findFirstPaymentLinkMethod.mockReset();
    createPaymentLinkOfflineReportAndNotify.mockReset();
  });

  const validBody = {
    paymentMethodConfigId: "method-check",
    payerName: "Jane Smith",
    payerEmail: "jane@example.com",
    amount: 50,
  };

  it("returns 404 when the link doesn't exist", async () => {
    findUniquePaymentLink.mockResolvedValueOnce(null);

    const response = await POST(buildRequest(validBody), params());

    expect(response.status).toBe(404);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("returns 404 when the link is inactive", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({ id: "link-1", organizationId: "org-a", status: "inactive", expiresAt: null });

    const response = await POST(buildRequest(validBody), params());

    expect(response.status).toBe(404);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("returns 410 when the link has expired", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({
      id: "link-1",
      organizationId: "org-a",
      status: "active",
      expiresAt: new Date("2020-01-01"),
    });

    const response = await POST(buildRequest(validBody), params());

    expect(response.status).toBe(410);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("rejects a reported amount below the link's configured minimum", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({
      id: "link-1",
      organizationId: "org-a",
      status: "active",
      expiresAt: null,
      amount: null,
      minAmount: 100,
    });

    const response = await POST(buildRequest({ ...validBody, amount: 10 }), params());

    expect(response.status).toBe(400);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("rejects a reported amount below a fixed-amount link's amount when no explicit minAmount is set", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({
      id: "link-1",
      organizationId: "org-a",
      status: "active",
      expiresAt: null,
      amount: 75,
      minAmount: null,
    });

    const response = await POST(buildRequest({ ...validBody, amount: 50 }), params());

    expect(response.status).toBe(400);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("rejects a paymentMethodConfigId that isn't actually attached to this link", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({ id: "link-1", organizationId: "org-a", status: "active", expiresAt: null });
    findFirstPaymentLinkMethod.mockResolvedValueOnce(null);

    const response = await POST(buildRequest(validBody), params());

    expect(response.status).toBe(400);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("rejects a method that is attached but has since been deactivated", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({ id: "link-1", organizationId: "org-a", status: "active", expiresAt: null });
    findFirstPaymentLinkMethod.mockResolvedValueOnce({
      paymentMethodConfig: { method: "CHECK", isActive: false },
    });

    const response = await POST(buildRequest(validBody), params());

    expect(response.status).toBe(400);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("rejects a Stripe (native) method -- offline reports are never for the online path", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({ id: "link-1", organizationId: "org-a", status: "active", expiresAt: null });
    findFirstPaymentLinkMethod.mockResolvedValueOnce({
      paymentMethodConfig: { method: "STRIPE", isActive: true },
    });

    const response = await POST(buildRequest({ ...validBody, paymentMethodConfigId: "method-stripe" }), params());

    expect(response.status).toBe(400);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("rejects an external-redirect method (PayPal/Venmo/Cash App) -- those have no report/reconciliation path", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({ id: "link-1", organizationId: "org-a", status: "active", expiresAt: null });
    findFirstPaymentLinkMethod.mockResolvedValueOnce({
      paymentMethodConfig: { method: "PAYPAL", isActive: true },
    });

    const response = await POST(buildRequest({ ...validBody, paymentMethodConfigId: "method-paypal" }), params());

    expect(response.status).toBe(400);
    expect(createPaymentLinkOfflineReportAndNotify).not.toHaveBeenCalled();
  });

  it("creates a pending report for a valid offline-category method and scopes it to the link's own organization", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({ id: "link-1", organizationId: "org-a", status: "active", expiresAt: null });
    findFirstPaymentLinkMethod.mockResolvedValueOnce({
      paymentMethodConfig: { method: "CHECK", isActive: true },
    });
    createPaymentLinkOfflineReportAndNotify.mockResolvedValueOnce({ id: "report-1" });

    const response = await POST(buildRequest(validBody), params());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, data: { id: "report-1" } });
    expect(createPaymentLinkOfflineReportAndNotify).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", paymentLinkId: "link-1", amount: 50 })
    );
  });
});
