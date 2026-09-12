import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SMS_ADDON } from "@/lib/sms-pricing";
import { isSmsAddOnPriceId, smsAddOnPriceId } from "@/lib/stripe";

/**
 * Stripe configuration readiness for the SMS add-on
 * (STRIPE_PRICE_SMS_ADDON_MONTHLY). The paid purchase flow must fail closed
 * when the price binding is absent or wrong — and nothing else in the SMS
 * stack may depend on it (audited billing-exempt enrollment via
 * /api/admin/sms/organizations/[id] never reads it; see that route's test
 * file, which passes with no Stripe env or mock at all).
 */
describe("SMS add-on Stripe price configuration", () => {
  const ENV_KEY = SMS_ADDON.stripePriceEnvKey;
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it("smsAddOnPriceId fails closed with a clear error naming the env var when it is unset", () => {
    delete process.env[ENV_KEY];
    expect(() => smsAddOnPriceId()).toThrow(/STRIPE_PRICE_SMS_ADDON_MONTHLY/);
  });

  it("smsAddOnPriceId returns the configured id when set", () => {
    process.env[ENV_KEY] = "price_test_sms_addon";
    expect(smsAddOnPriceId()).toBe("price_test_sms_addon");
  });

  it("isSmsAddOnPriceId matches nothing while the env var is unset — the webhook can never mistake another line item for the add-on", () => {
    delete process.env[ENV_KEY];
    expect(isSmsAddOnPriceId("price_test_sms_addon")).toBe(false);
    expect(isSmsAddOnPriceId("")).toBe(false);
  });

  it("isSmsAddOnPriceId compares strictly against the configured id", () => {
    process.env[ENV_KEY] = "price_test_sms_addon";
    expect(isSmsAddOnPriceId("price_test_sms_addon")).toBe(true);
    expect(isSmsAddOnPriceId("price_other")).toBe(false);
  });
});
