import { beforeEach, describe, expect, it, vi } from "vitest";

const validateReportExportCronSecret = vi.fn();
vi.mock("@/lib/cron-auth", () => ({ validateReportExportCronSecret: (...a: unknown[]) => validateReportExportCronSecret(...a) }));

const requireRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: (...a: unknown[]) => requireRateLimit(...a) }));

const processQueuedReportExports = vi.fn();
vi.mock("@/lib/reports", () => ({ processQueuedReportExports: (...a: unknown[]) => processQueuedReportExports(...a) }));

function request(auth: string | null) {
  const headers = new Headers();
  if (auth !== null) headers.set("authorization", auth);
  return new Request("https://portal.test/api/cron/reports", { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRateLimit.mockResolvedValue(null);
  processQueuedReportExports.mockResolvedValue({
    processed: 3,
    cleanupChecked: 5,
    cleanupDeleted: 2,
    artifactCleanupChecked: 4,
    artifactCleanupCleaned: 1,
  });
});

describe("/api/cron/reports (fix/report-export-queue-hardening)", () => {
  it("authenticates with the dedicated validator, not the shared one", async () => {
    validateReportExportCronSecret.mockReturnValue(true);
    const { POST } = await import("../route");
    await POST(request("Bearer whatever"));
    expect(validateReportExportCronSecret).toHaveBeenCalled();
  });

  it("rejects with 401 when the dedicated secret check fails, never touching the queue", async () => {
    validateReportExportCronSecret.mockReturnValue(false);
    const { POST } = await import("../route");
    const res = await POST(request(null));
    expect(res.status).toBe(401);
    expect(processQueuedReportExports).not.toHaveBeenCalled();
  });

  it("returns a sanitized, count-only summary — never organization data, keys, or error details", async () => {
    validateReportExportCronSecret.mockReturnValue(true);
    const { POST } = await import("../route");
    const res = await POST(request("Bearer x"));
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      processed: 3,
      cleanupChecked: 5,
      cleanupDeleted: 2,
      artifactCleanupChecked: 4,
      artifactCleanupCleaned: 1,
    });
  });

  it("is safe when called with zero eligible jobs", async () => {
    validateReportExportCronSecret.mockReturnValue(true);
    processQueuedReportExports.mockResolvedValue({
      processed: 0,
      cleanupChecked: 0,
      cleanupDeleted: 0,
      artifactCleanupChecked: 0,
      artifactCleanupCleaned: 0,
    });
    const { POST } = await import("../route");
    const res = await POST(request("Bearer x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it("passes a bounded batch size and bounded cleanup limit — never unbounded", async () => {
    validateReportExportCronSecret.mockReturnValue(true);
    const { POST } = await import("../route");
    await POST(request("Bearer x"));
    const [batchLimit, cleanupLimit] = processQueuedReportExports.mock.calls[0];
    expect(typeof batchLimit).toBe("number");
    expect(batchLimit).toBeGreaterThan(0);
    expect(typeof cleanupLimit).toBe("number");
    expect(cleanupLimit).toBeGreaterThan(0);
  });

  it("rate limiting is checked before secret validation", async () => {
    const limitedResponse = Response.json({ ok: false, error: "rate limited" }, { status: 429 });
    requireRateLimit.mockResolvedValue(limitedResponse);
    const { POST } = await import("../route");
    const res = await POST(request("Bearer x"));
    expect(res.status).toBe(429);
    expect(validateReportExportCronSecret).not.toHaveBeenCalled();
  });

  it("uses a scope dedicated to this route, not the shared 'api:cron' scope every other cron endpoint uses (follow-up review finding: cross-route quota exhaustion)", async () => {
    validateReportExportCronSecret.mockReturnValue(true);
    const { POST } = await import("../route");
    await POST(request("Bearer x"));
    const scopeUsed = requireRateLimit.mock.calls[0][0].scope;
    expect(scopeUsed).not.toBe("api:cron");
    expect(scopeUsed).toContain("reports");
  });

  it("the rate limit is generous relative to any realistic scheduler cadence — cannot lock out a legitimate 5-minute-interval caller", async () => {
    validateReportExportCronSecret.mockReturnValue(true);
    const { POST } = await import("../route");
    await POST(request("Bearer x"));
    const { limit, windowMs } = requireRateLimit.mock.calls[0][0];
    // A caller needing 1 request per 300s window must never be starved by
    // its own normal traffic — the configured limit is well above that.
    expect(limit).toBeGreaterThan(5);
    expect(windowMs).toBeLessThanOrEqual(120_000);
  });

  it("repeated invalid (unauthenticated) requests against this dedicated scope do not consume a quota shared with any other route", async () => {
    // The isolation guarantee itself: since the scope string is unique to
    // this route (proven above), rate-limit state keyed by `rl:${scope}:${ip}`
    // (see rate-limit.ts) can never be shared with another route's calls,
    // regardless of how many invalid requests hit this or any other
    // endpoint from the same apparent IP.
    validateReportExportCronSecret.mockReturnValue(false);
    const { POST } = await import("../route");
    for (let i = 0; i < 5; i++) {
      await POST(request(null));
    }
    expect(requireRateLimit).toHaveBeenCalledTimes(5);
    for (const call of requireRateLimit.mock.calls) {
      expect(call[0].scope).not.toBe("api:cron");
    }
  });
});
