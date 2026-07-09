import { describe, expect, it } from "vitest";
import { computeOrgSmsCharges, computeSmsCostSummary, SMS_PLAN_TIERS } from "@/lib/sms-admin-pricing";

describe("SMS_PLAN_TIERS", () => {
  it("defines Starter, Growth, and Enterprise", () => {
    expect(Object.keys(SMS_PLAN_TIERS)).toEqual(["STARTER", "GROWTH", "ENTERPRISE"]);
    expect(SMS_PLAN_TIERS.STARTER).toMatchObject({ includedMessages: 1000, monthlyPriceCents: 1000, overageRateCents: 2 });
    expect(SMS_PLAN_TIERS.GROWTH).toMatchObject({ includedMessages: 3000, monthlyPriceCents: 2500, overageRateCents: 1.5 });
    expect(SMS_PLAN_TIERS.ENTERPRISE.custom).toBe(true);
  });
});

describe("computeOrgSmsCharges", () => {
  it("charges only the plan price when usage is within the limit", () => {
    const result = computeOrgSmsCharges({
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 500,
      smsOverageRateCents: 2,
      planPriceCents: 1000,
    });
    expect(result).toEqual({ planPriceCents: 1000, overageMessages: 0, overageChargeCents: 0, totalChargeCents: 1000 });
  });

  it("adds overage charges past the limit", () => {
    const result = computeOrgSmsCharges({
      smsMonthlyLimit: 1000,
      smsUsedThisPeriod: 1250,
      smsOverageRateCents: 2,
      planPriceCents: 1000,
    });
    expect(result.overageMessages).toBe(250);
    expect(result.overageChargeCents).toBe(500);
    expect(result.totalChargeCents).toBe(1500);
  });

  it("handles fractional-cent overage rates (Growth tier)", () => {
    const result = computeOrgSmsCharges({
      smsMonthlyLimit: 3000,
      smsUsedThisPeriod: 3100,
      smsOverageRateCents: 1.5,
      planPriceCents: 2500,
    });
    expect(result.overageChargeCents).toBe(150);
    expect(result.totalChargeCents).toBe(2650);
  });
});

describe("computeSmsCostSummary", () => {
  it("computes customer charges, Twilio cost, carrier fee, and profit across orgs", () => {
    const summary = computeSmsCostSummary({
      organizations: [
        { smsMonthlyLimit: 1000, smsUsedThisPeriod: 1200, smsOverageRateCents: 2, planPriceCents: 1000 },
        { smsMonthlyLimit: 3000, smsUsedThisPeriod: 2000, smsOverageRateCents: 1.5, planPriceCents: 2500 },
      ],
      twilioCostCents: 1000,
      carrierFeePercent: 10,
    });

    // org 1: 1000 + 200*2 = 1400; org 2: 2500 + 0 = 2500 -> customerCharges = 3900
    expect(summary.customerChargesCents).toBe(3900);
    expect(summary.twilioCostCents).toBe(1000);
    expect(summary.carrierFeeCents).toBe(100);
    expect(summary.profitCents).toBe(3900 - 1000 - 100);
  });

  it("defaults carrier fee to 0 when the percent is 0", () => {
    const summary = computeSmsCostSummary({ organizations: [], twilioCostCents: 500, carrierFeePercent: 0 });
    expect(summary.carrierFeeCents).toBe(0);
    expect(summary.profitCents).toBe(-500);
  });
});
