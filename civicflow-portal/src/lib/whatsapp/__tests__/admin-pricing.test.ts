import { describe, expect, it } from "vitest";
import { computeOrgWhatsAppCharges, computeWhatsAppCostSummary } from "@/lib/whatsapp/admin-pricing";
import { WHATSAPP_ADDON } from "@/lib/whatsapp/pricing";

describe("computeOrgWhatsAppCharges", () => {
  it("charges only the flat plan price when usage is within the limit", () => {
    const result = computeOrgWhatsAppCharges({
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 200,
      whatsappOverageRateCents: 5,
    });
    expect(result).toEqual({
      planPriceCents: WHATSAPP_ADDON.monthlyPriceCents,
      overageMessages: 0,
      overageChargeCents: 0,
      totalChargeCents: WHATSAPP_ADDON.monthlyPriceCents,
    });
  });

  it("adds overage charges past the limit", () => {
    const result = computeOrgWhatsAppCharges({
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 650,
      whatsappOverageRateCents: 5,
    });
    expect(result.overageMessages).toBe(150);
    expect(result.overageChargeCents).toBe(750);
    expect(result.totalChargeCents).toBe(WHATSAPP_ADDON.monthlyPriceCents + 750);
  });

  it("treats usage exactly at the limit as zero overage", () => {
    const result = computeOrgWhatsAppCharges({
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 500,
      whatsappOverageRateCents: 5,
    });
    expect(result.overageMessages).toBe(0);
    expect(result.overageChargeCents).toBe(0);
  });

  it("never reports negative overage when usage is below the limit", () => {
    const result = computeOrgWhatsAppCharges({
      whatsappMonthlyLimit: 500,
      whatsappUsedThisPeriod: 0,
      whatsappOverageRateCents: 5,
    });
    expect(result.overageMessages).toBe(0);
    expect(result.overageChargeCents).toBe(0);
  });
});

describe("computeWhatsAppCostSummary", () => {
  it("sums flat-plan customer charges across orgs and computes profit against Twilio cost", () => {
    const summary = computeWhatsAppCostSummary({
      organizations: [
        { whatsappMonthlyLimit: 500, whatsappUsedThisPeriod: 600, whatsappOverageRateCents: 5 },
        { whatsappMonthlyLimit: 500, whatsappUsedThisPeriod: 100, whatsappOverageRateCents: 5 },
      ],
      twilioCostCents: 1000,
    });

    // org 1: 1500 + 100*5 = 2000; org 2: 1500 + 0 = 1500 -> customerCharges = 3500
    expect(summary.customerChargesCents).toBe(3500);
    expect(summary.twilioCostCents).toBe(1000);
    expect(summary.profitCents).toBe(2500);
  });

  it("handles zero organizations", () => {
    const summary = computeWhatsAppCostSummary({ organizations: [], twilioCostCents: 500 });
    expect(summary.customerChargesCents).toBe(0);
    expect(summary.profitCents).toBe(-500);
  });
});
