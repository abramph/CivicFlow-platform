import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileMembership = vi.fn();
const requireMobileOrgAccess = vi.fn();
vi.mock("@/lib/mobile-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return {
    ...actual,
    requireMobileMembership: (...args: unknown[]) => requireMobileMembership(...args),
    requireMobileOrgAccess: (...args: unknown[]) => requireMobileOrgAccess(...args),
  };
});

const findManyCampaign = vi.fn().mockResolvedValue([]);
const findManyPaymentMethodConfig = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: { findMany: (...args: unknown[]) => findManyCampaign(...args) },
    paymentMethodConfig: { findMany: (...args: unknown[]) => findManyPaymentMethodConfig(...args) },
  },
}));

const findActivePaymentLink = vi.fn();
vi.mock("@/lib/payment-links", () => ({
  findActivePaymentLink: (...args: unknown[]) => findActivePaymentLink(...args),
}));

import { GET as campaignsGET } from "@/app/api/mobile/campaigns/route";
import { GET as paymentMethodsGET } from "@/app/api/mobile/payment-methods/route";
import { GET as paymentLinkGET } from "@/app/api/mobile/payment-link/route";

function request(path: string) {
  return new Request(`https://portal.test${path}`);
}

describe("GET /api/mobile/campaigns", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    findManyCampaign.mockClear();
  });

  it("requires organizationId", async () => {
    const response = await campaignsGET(request("/api/mobile/campaigns"));
    expect(response.status).toBe(400);
    expect(requireMobileMembership).not.toHaveBeenCalled();
  });

  it("scopes the query to the verified organization and only active campaigns", async () => {
    requireMobileMembership.mockResolvedValueOnce({ organizationId: "org-a" });
    await campaignsGET(request("/api/mobile/campaigns?organizationId=org-a"));
    expect(findManyCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-a", status: "active" } })
    );
  });
});

describe("GET /api/mobile/payment-methods", () => {
  beforeEach(() => {
    requireMobileOrgAccess.mockReset();
    findManyPaymentMethodConfig.mockReset();
  });

  it("filters out methods with no identifier or instructions", async () => {
    requireMobileOrgAccess.mockResolvedValueOnce({ organizationId: "org-a" });
    findManyPaymentMethodConfig.mockResolvedValueOnce([
      { id: "1", label: "Cash", accountIdentifier: null, instructions: null },
      { id: "2", label: "Zelle", accountIdentifier: "treasurer@org.com", instructions: null },
    ]);

    const response = await paymentMethodsGET(request("/api/mobile/payment-methods?organizationId=org-a"));
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].label).toBe("Zelle");
  });
});

describe("GET /api/mobile/payment-link", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    findActivePaymentLink.mockReset();
  });

  it("requires one of campaignId, eventId, or dues", async () => {
    requireMobileMembership.mockResolvedValueOnce({ organizationId: "org-a" });
    const response = await paymentLinkGET(request("/api/mobile/payment-link?organizationId=org-a"));
    expect(response.status).toBe(400);
    expect(findActivePaymentLink).not.toHaveBeenCalled();
  });

  it("returns a null slug when no active link is configured", async () => {
    requireMobileMembership.mockResolvedValueOnce({ organizationId: "org-a" });
    findActivePaymentLink.mockResolvedValueOnce(null);

    const response = await paymentLinkGET(request("/api/mobile/payment-link?organizationId=org-a&campaignId=camp-1"));
    const body = await response.json();

    expect(body.data.slug).toBeNull();
    expect(findActivePaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", campaignId: "camp-1" })
    );
  });

  it("resolves the dues-in-advance link by linkType instead of campaign/event", async () => {
    requireMobileMembership.mockResolvedValueOnce({ organizationId: "org-a" });
    findActivePaymentLink.mockResolvedValueOnce({ slug: "org-dues" });

    const response = await paymentLinkGET(request("/api/mobile/payment-link?organizationId=org-a&dues=true"));
    const body = await response.json();

    expect(body.data.slug).toBe("org-dues");
    expect(findActivePaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", linkType: "DUES" })
    );
  });
});
