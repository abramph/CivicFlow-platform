import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unestra Cloud (CLOUD-D). No test existed for this route before this
 * program — the audit flagged it as a real gap. Covers the core server-
 * authority guarantee: the client sends only a billing interval, never a
 * plan/vertical/price, and the server resolves the plan entirely from the
 * organization's own primaryVertical (see route.ts's doc comment).
 */

vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ NEXTAUTH_URL: "https://app.getunestra.com" }) }));

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
const seatPriceIdForPlan = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getOrCreateStripeCustomer: (...args: unknown[]) => getOrCreateStripeCustomer(...args),
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
  priceIdForPlan: (...args: unknown[]) => priceIdForPlan(...args),
  seatPriceIdForPlan: (...args: unknown[]) => seatPriceIdForPlan(...args),
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
    seatPriceIdForPlan.mockReturnValue("price_seat_resolved");
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
});
