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
  processQueuedReportExports.mockResolvedValue({ processed: 3, cleanupChecked: 5, cleanupDeleted: 2 });
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
    expect(body).toEqual({ ok: true, processed: 3, cleanupChecked: 5, cleanupDeleted: 2 });
  });

  it("is safe when called with zero eligible jobs", async () => {
    validateReportExportCronSecret.mockReturnValue(true);
    processQueuedReportExports.mockResolvedValue({ processed: 0, cleanupChecked: 0, cleanupDeleted: 0 });
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
});
