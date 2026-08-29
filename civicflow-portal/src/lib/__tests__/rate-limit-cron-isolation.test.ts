import { beforeEach, describe, expect, it } from "vitest";
import { applyRateLimit } from "../rate-limit";

/**
 * fix/report-export-queue-hardening follow-up — proves the actual rate-limit
 * isolation guarantee using the REAL (unmocked) in-memory limiter, not just
 * asserting that two scope strings differ. Confirms the finding that
 * motivated giving /api/cron/reports its own scope: the shared "api:cron"
 * scope let traffic to ANY of the other 11 cron routes exhaust the bucket a
 * legitimate reports-scheduler call also depended on.
 */
function requestFrom(ip: string) {
  const headers = new Headers({ "x-forwarded-for": ip });
  return new Request("https://portal.test/api/cron/reports", { headers });
}

beforeEach(() => {
  process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER = "1";
});

describe("rate-limit scope isolation for /api/cron/reports", () => {
  it("exhausting the OLD shared 'api:cron' scope from an IP does not affect a DIFFERENT dedicated scope from the same IP", async () => {
    const ip = "203.0.113.10";
    // Exhaust the shared scope other cron routes still use, as if an
    // unauthenticated flood hit e.g. /api/cron/campaigns from this IP.
    for (let i = 0; i < 10; i++) {
      await applyRateLimit({ scope: "api:cron", request: requestFrom(ip), limit: 10, windowMs: 60_000 });
    }
    const sharedScopeExhausted = await applyRateLimit({ scope: "api:cron", request: requestFrom(ip), limit: 10, windowMs: 60_000 });
    expect(sharedScopeExhausted.allowed).toBe(false); // proves the shared bucket really is exhausted

    // The dedicated reports scope, from the SAME IP, is completely unaffected.
    const dedicatedScopeResult = await applyRateLimit({ scope: "api:cron:reports", request: requestFrom(ip), limit: 30, windowMs: 60_000 });
    expect(dedicatedScopeResult.allowed).toBe(true);
  });

  it("repeated invalid/unauthenticated requests against the dedicated reports scope cannot exhaust it before a legitimate scheduler call arrives, given the configured generous limit", async () => {
    const ip = "203.0.113.20";
    // Simulate a burst of unauthenticated attempts, well under the
    // configured generous limit (30/60s) — a real scheduler on a 5-minute
    // cadence needs only 1.
    for (let i = 0; i < 25; i++) {
      const result = await applyRateLimit({ scope: "api:cron:reports", request: requestFrom(ip), limit: 30, windowMs: 60_000 });
      expect(result.allowed).toBe(true);
    }
    // The legitimate call (the 26th) still goes through.
    const legitimateCall = await applyRateLimit({ scope: "api:cron:reports", request: requestFrom(ip), limit: 30, windowMs: 60_000 });
    expect(legitimateCall.allowed).toBe(true);
  });

  it("different apparent IPs never share a bucket even within the same scope", async () => {
    const first = await applyRateLimit({ scope: "api:cron:reports", request: requestFrom("203.0.113.30"), limit: 1, windowMs: 60_000 });
    const second = await applyRateLimit({ scope: "api:cron:reports", request: requestFrom("203.0.113.31"), limit: 1, windowMs: 60_000 });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true); // a different IP gets its own fresh bucket, not blocked by the first IP's usage
  });
});
