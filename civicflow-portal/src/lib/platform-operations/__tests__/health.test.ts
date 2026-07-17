import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const smsMessageFindFirst = vi.fn();
const smsMessageCount = vi.fn();
const emailReminderLogFindFirst = vi.fn();
const emailReminderLogCount = vi.fn();
const reportExportFindFirst = vi.fn();
const reportExportCount = vi.fn();
const communicationCampaignFindFirst = vi.fn();
const communicationCampaignCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
    smsMessage: { findFirst: (...a: unknown[]) => smsMessageFindFirst(...a), count: (...a: unknown[]) => smsMessageCount(...a) },
    emailReminderLog: { findFirst: (...a: unknown[]) => emailReminderLogFindFirst(...a), count: (...a: unknown[]) => emailReminderLogCount(...a) },
    reportExport: { findFirst: (...a: unknown[]) => reportExportFindFirst(...a), count: (...a: unknown[]) => reportExportCount(...a) },
    communicationCampaign: { findFirst: (...a: unknown[]) => communicationCampaignFindFirst(...a), count: (...a: unknown[]) => communicationCampaignCount(...a) },
  },
}));

const balanceRetrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ balance: { retrieve: (...args: unknown[]) => balanceRetrieve(...args) } }),
}));

const getEffectiveTwilioCredentials = vi.fn();
vi.mock("@/lib/sms-credentials", () => ({
  getEffectiveTwilioCredentials: (...args: unknown[]) => getEffectiveTwilioCredentials(...args),
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  smsMessageFindFirst.mockResolvedValue(null);
  smsMessageCount.mockResolvedValue(0);
  emailReminderLogFindFirst.mockResolvedValue(null);
  emailReminderLogCount.mockResolvedValue(0);
  reportExportFindFirst.mockResolvedValue(null);
  reportExportCount.mockResolvedValue(0);
  communicationCampaignFindFirst.mockResolvedValue(null);
  communicationCampaignCount.mockResolvedValue(0);
  getEffectiveTwilioCredentials.mockResolvedValue(null);
});

describe("getSystemHealth — database", () => {
  it("is healthy when the query round-trip succeeds", async () => {
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const db = checks.find((c) => c.service === "Production database");
    expect(db?.status).toBe("healthy");
    expect(db?.freshness).toBe("live");
  });

  it("is unavailable (not a fabricated healthy) when the query throws", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connection refused"));
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const db = checks.find((c) => c.service === "Production database");
    expect(db?.status).toBe("unavailable");
    expect(db?.message).toBe("Check failed — see server logs for detail");
  });

  it("never leaks the raw driver error (which can contain internal hostnames/connection details) into the rendered message", async () => {
    queryRaw.mockRejectedValueOnce(
      new Error("Can't reach database server at `civicflowprod-do-user-38042660-0.g.db.ondigitalocean.com:25060`")
    );
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const db = checks.find((c) => c.service === "Production database");
    expect(db?.message).not.toContain("ondigitalocean.com");
    expect(db?.message).not.toContain("25060");
  });
});

describe("getSystemHealth — Stripe", () => {
  it("is not_configured when STRIPE_SECRET_KEY is unset, and makes no live call", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const stripe = checks.find((c) => c.service === "Stripe");
    expect(stripe?.status).toBe("not_configured");
    expect(balanceRetrieve).not.toHaveBeenCalled();
  });

  it("is healthy when configured and the live balance call succeeds", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    balanceRetrieve.mockResolvedValueOnce({ available: [] });
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const stripe = checks.find((c) => c.service === "Stripe");
    expect(stripe?.status).toBe("healthy");
    expect(stripe?.freshness).toBe("live");
  });

  it("is degraded — not a page-crashing exception — when the live Stripe call fails", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    balanceRetrieve.mockRejectedValueOnce(new Error("Stripe API error"));
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const stripe = checks.find((c) => c.service === "Stripe");
    expect(stripe?.status).toBe("degraded");
  });
});

describe("getSystemHealth — Twilio", () => {
  it("is not_configured when no credentials are found in database or env", async () => {
    getEffectiveTwilioCredentials.mockResolvedValueOnce(null);
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    expect(checks.find((c) => c.service === "Twilio")?.status).toBe("not_configured");
  });

  it("is healthy (inferred, not live) when credentials are configured", async () => {
    getEffectiveTwilioCredentials.mockResolvedValueOnce({ accountSid: "AC1", authToken: "x", apiKey: null, apiSecret: null, messagingServiceSid: null, fromNumber: null, source: "env" });
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const twilio = checks.find((c) => c.service === "Twilio");
    expect(twilio?.status).toBe("healthy");
    expect(twilio?.freshness).toBe("inferred");
  });
});

describe("getSystemHealth — partial failure isolation", () => {
  it("still returns every other check when the database check fails", async () => {
    queryRaw.mockRejectedValueOnce(new Error("timeout"));
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    expect(checks.length).toBeGreaterThanOrEqual(9);
    expect(checks.every((c) => c.status !== undefined)).toBe(true);
  });

  it("never reports a status outside the defined ServiceStatus set", async () => {
    const { getSystemHealth } = await import("../health");
    const checks = await getSystemHealth();
    const allowed = new Set(["healthy", "degraded", "unavailable", "not_configured", "unknown"]);
    for (const check of checks) {
      expect(allowed.has(check.status)).toBe(true);
    }
  });
});
