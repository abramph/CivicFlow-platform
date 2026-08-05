import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
    }),
  };
});

const findFirstCampaign = vi.fn();
const findFirstEvent = vi.fn();
const findUniquePaymentLink = vi.fn();
const createPaymentLink = vi.fn();
const findManyPaymentLink = vi.fn();
const findManyPaymentMethodConfig = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findFirst: (...args: unknown[]) => findFirstCampaign(...args) },
    event: { findFirst: (...args: unknown[]) => findFirstEvent(...args) },
    paymentLink: {
      findUnique: (...args: unknown[]) => findUniquePaymentLink(...args),
      create: (...args: unknown[]) => createPaymentLink(...args),
      findMany: (...args: unknown[]) => findManyPaymentLink(...args),
    },
    paymentMethodConfig: {
      findMany: (...args: unknown[]) => findManyPaymentMethodConfig(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/payment-links/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/payment-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/payment-links", () => {
  beforeEach(() => {
    findFirstCampaign.mockReset();
    findFirstEvent.mockReset();
    findUniquePaymentLink.mockReset().mockResolvedValue(null);
    createPaymentLink.mockReset();
    findManyPaymentMethodConfig.mockReset().mockResolvedValue([{ id: "method-stripe", method: "STRIPE", isActive: true }]);
  });

  it("rejects a campaignId that doesn't belong to the caller's organization", async () => {
    findFirstCampaign.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ title: "Fall Fun Run", linkType: "CAMPAIGN", campaignId: "campaign-other-org" }));

    expect(response.status).toBe(400);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("rejects an eventId that doesn't belong to the caller's organization", async () => {
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ title: "Gala", linkType: "EVENT", eventId: "event-other-org" }));

    expect(response.status).toBe(400);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("retries slug generation once on a collision", async () => {
    findUniquePaymentLink.mockResolvedValueOnce({ id: "existing" });
    createPaymentLink.mockResolvedValueOnce({ id: "link-1", title: "Dues", slug: "dues-abc123", linkType: "DUES" });

    const response = await POST(
      postRequest({ title: "Dues", linkType: "DUES", paymentMethodConfigIds: ["method-stripe"] })
    );

    expect(response.status).toBe(201);
    expect(findUniquePaymentLink).toHaveBeenCalledTimes(1);
    expect(createPaymentLink).toHaveBeenCalledTimes(1);
  });

  it("rejects a request with no payment methods selected", async () => {
    const response = await POST(postRequest({ title: "General Fund", paymentMethodConfigIds: [] }));

    expect(response.status).toBe(400);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("rejects payment method ids that aren't active configs owned by the caller's organization", async () => {
    findManyPaymentMethodConfig.mockReset().mockResolvedValue([]);

    const response = await POST(
      postRequest({ title: "General Fund", paymentMethodConfigIds: ["method-other-org"] })
    );

    expect(response.status).toBe(400);
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("creates a payment link scoped to the caller's organization", async () => {
    createPaymentLink.mockResolvedValueOnce({ id: "link-1", title: "General Fund", slug: "general-fund-abc123", linkType: "GENERAL" });

    const response = await POST(
      postRequest({ title: "General Fund", paymentMethodConfigIds: ["method-stripe"] })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", linkType: "GENERAL" }) })
    );
  });
});

describe("GET /api/payment-links", () => {
  it("scopes the query to the caller's organization", async () => {
    findManyPaymentLink.mockResolvedValueOnce([]);
    await GET();
    expect(findManyPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});
