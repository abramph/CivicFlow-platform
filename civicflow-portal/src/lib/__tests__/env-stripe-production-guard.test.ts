import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for the Thrivepathmhs Cloud-checkout incident: production
 * had a test-mode STRIPE_SECRET_KEY paired with live-mode Cloud Prices, so
 * every checkout attempt failed deep inside the Stripe SDK with a generic
 * 500. getServerEnv() now fails fast at boot instead of letting a
 * mismatched key reach a live request. STRIPE_TEST_SECRET_KEY (the separate,
 * intentionally test-mode key used for connected-account onboarding) must
 * stay unaffected by this check.
 */
describe("getServerEnv — production requires a live-mode Stripe secret key", () => {
  const OLD = { ...process.env };

  const REQUIRED_PROD_ENV = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:pass@host:5432/db",
    NEXTAUTH_SECRET: "a".repeat(32),
    NEXTAUTH_URL: "https://app.getunestra.com",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    DO_SPACES_ENDPOINT: "https://nyc3.digitaloceanspaces.com",
    DO_SPACES_REGION: "nyc3",
    DO_SPACES_BUCKET: "bucket",
    DO_SPACES_ACCESS_KEY_ID: "key-id",
    DO_SPACES_SECRET_ACCESS_KEY: "key-secret",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "user",
    SMTP_PASS: "pass",
    FROM_EMAIL: "no-reply@getunestra.com",
  } as const;

  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = OLD;
  });

  async function load() {
    return import("@/lib/env");
  }

  it("throws when STRIPE_SECRET_KEY is a test-mode key in production", async () => {
    process.env = {
      ...OLD,
      ...REQUIRED_PROD_ENV,
      STRIPE_SECRET_KEY: "sk_test_abc123",
    } as NodeJS.ProcessEnv;

    const { getServerEnv } = await load();
    expect(() => getServerEnv()).toThrow(/live-mode secret key/i);
  });

  it("succeeds when STRIPE_SECRET_KEY is a full-access live-mode key (sk_live_...)", async () => {
    process.env = {
      ...OLD,
      ...REQUIRED_PROD_ENV,
      STRIPE_SECRET_KEY: "sk_live_abc123",
    } as NodeJS.ProcessEnv;

    const { getServerEnv } = await load();
    expect(() => getServerEnv()).not.toThrow();
  });

  it("succeeds when STRIPE_SECRET_KEY is a restricted live-mode key (rk_live_...) — the recommended, more secure option", async () => {
    process.env = {
      ...OLD,
      ...REQUIRED_PROD_ENV,
      STRIPE_SECRET_KEY: "rk_live_abc123",
    } as NodeJS.ProcessEnv;

    const { getServerEnv } = await load();
    expect(() => getServerEnv()).not.toThrow();
  });

  it("throws when STRIPE_SECRET_KEY is a restricted test-mode key (rk_test_...) in production", async () => {
    process.env = {
      ...OLD,
      ...REQUIRED_PROD_ENV,
      STRIPE_SECRET_KEY: "rk_test_abc123",
    } as NodeJS.ProcessEnv;

    const { getServerEnv } = await load();
    expect(() => getServerEnv()).toThrow(/live-mode secret key/i);
  });

  it("does not require STRIPE_TEST_SECRET_KEY to be live-mode — that key stays test-mode by design", async () => {
    process.env = {
      ...OLD,
      ...REQUIRED_PROD_ENV,
      STRIPE_SECRET_KEY: "sk_live_abc123",
      STRIPE_TEST_SECRET_KEY: "sk_test_connected_account_onboarding",
    } as NodeJS.ProcessEnv;

    const { getServerEnv } = await load();
    const env = getServerEnv();
    expect(env.STRIPE_TEST_SECRET_KEY).toBe("sk_test_connected_account_onboarding");
  });
});
