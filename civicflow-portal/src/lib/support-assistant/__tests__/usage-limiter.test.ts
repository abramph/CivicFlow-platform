import { beforeEach, describe, expect, it, vi } from "vitest";

const requireRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

const labUsageEventCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { labUsageEvent: { count: (...a: unknown[]) => labUsageEventCount(...a) } },
}));

const recordLabUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/usage", () => ({ recordLabUsage: (...a: unknown[]) => recordLabUsage(...a) }));

function req() {
  return new Request("https://portal.test/api/support-assistant", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRateLimit.mockResolvedValue(null);
  labUsageEventCount.mockResolvedValue(0);
});

describe("enforcePublicUsageLimits", () => {
  it("passes when under both the burst rate limit and the daily IP ceiling", async () => {
    const { enforcePublicUsageLimits } = await import("../usage-limiter");
    await expect(enforcePublicUsageLimits(req())).resolves.toBeUndefined();
  });

  it("throws SUPPORT_ASSISTANT_RATE_LIMITED when the burst limiter rejects", async () => {
    requireRateLimit.mockResolvedValueOnce(new Response("", { status: 429 }));
    const { enforcePublicUsageLimits } = await import("../usage-limiter");
    await expect(enforcePublicUsageLimits(req())).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_RATE_LIMITED" });
  });

  it("throws SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED after 20 requests from the same IP in one day", async () => {
    const { enforcePublicUsageLimits } = await import("../usage-limiter");
    const sameIpRequest = () => {
      const r = new Request("https://portal.test/api/support-assistant", { method: "POST", headers: { "x-forwarded-for": "203.0.113.5" } });
      return r;
    };
    for (let i = 0; i < 20; i++) {
      await enforcePublicUsageLimits(sameIpRequest());
    }
    await expect(enforcePublicUsageLimits(sameIpRequest())).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED" });
  });

  it("tracks separate IPs independently", async () => {
    const { enforcePublicUsageLimits } = await import("../usage-limiter");
    const ip1 = new Request("https://portal.test/api/support-assistant", { method: "POST", headers: { "x-forwarded-for": "203.0.113.10" } });
    const ip2 = new Request("https://portal.test/api/support-assistant", { method: "POST", headers: { "x-forwarded-for": "203.0.113.11" } });
    for (let i = 0; i < 20; i++) {
      await enforcePublicUsageLimits(ip1);
    }
    // ip2 has never been seen, so it should still pass even though ip1 is exhausted.
    await expect(enforcePublicUsageLimits(ip2)).resolves.toBeUndefined();
  });
});

describe("enforceAuthenticatedUsageLimits", () => {
  it("passes when under both the burst rate limit and the daily org ceiling", async () => {
    const { enforceAuthenticatedUsageLimits } = await import("../usage-limiter");
    await expect(enforceAuthenticatedUsageLimits(req(), "org-a")).resolves.toBeUndefined();
    expect(labUsageEventCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a", featureKey: "supportAssistant" }) })
    );
  });

  it("throws SUPPORT_ASSISTANT_RATE_LIMITED when the burst limiter rejects", async () => {
    requireRateLimit.mockResolvedValueOnce(new Response("", { status: 429 }));
    const { enforceAuthenticatedUsageLimits } = await import("../usage-limiter");
    await expect(enforceAuthenticatedUsageLimits(req(), "org-a")).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_RATE_LIMITED" });
  });

  it("throws SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED when the org has already hit its daily ceiling", async () => {
    labUsageEventCount.mockResolvedValueOnce(50);
    const { enforceAuthenticatedUsageLimits } = await import("../usage-limiter");
    await expect(enforceAuthenticatedUsageLimits(req(), "org-a")).rejects.toMatchObject({ code: "SUPPORT_ASSISTANT_DAILY_LIMIT_REACHED" });
  });
});

describe("recordAuthenticatedUsage", () => {
  it("records at least 1 unit even for a tiny estimated-token count", async () => {
    const { recordAuthenticatedUsage } = await import("../usage-limiter");
    await recordAuthenticatedUsage("org-a", 0);
    expect(recordLabUsage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-a", featureKey: "supportAssistant", unit: "ai_tokens", quantity: 1 })
    );
  });
});
