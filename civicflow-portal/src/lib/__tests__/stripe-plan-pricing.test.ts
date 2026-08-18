import { afterEach, describe, expect, it, vi } from "vitest";
import { priceIdForPlan, planFromPriceId, seatPriceIdForPlan, isSeatPriceId } from "@/lib/stripe";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("priceIdForPlan / planFromPriceId (catalog-driven, not hardcoded per plan)", () => {
  it("resolves a Cloud plan's own baked-in interval regardless of the interval argument", () => {
    process.env.STRIPE_PRICE_PTA_MONTHLY = "price_pta_m";
    expect(priceIdForPlan("pta_monthly", "year")).toBe("price_pta_m");
  });

  it("resolves a legacy plan using the passed interval, since legacy ids don't encode one", () => {
    process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY = "price_ess_m";
    process.env.STRIPE_PRICE_ESSENTIAL_YEARLY = "price_ess_y";
    expect(priceIdForPlan("essential", "month")).toBe("price_ess_m");
    expect(priceIdForPlan("essential", "year")).toBe("price_ess_y");
  });

  it("throws with the plan/interval named when no env var is configured", () => {
    delete process.env.STRIPE_PRICE_UNION_MONTHLY;
    expect(() => priceIdForPlan("union_monthly")).toThrow(/union_monthly/);
  });

  it("round-trips every one of the 8 Cloud plans through planFromPriceId", () => {
    process.env.STRIPE_PRICE_PTA_MONTHLY = "p1";
    process.env.STRIPE_PRICE_CHURCH_YEARLY = "p2";
    expect(planFromPriceId("p1")).toBe("pta_monthly");
    expect(planFromPriceId("p2")).toBe("church_annual");
    expect(planFromPriceId("unconfigured-price-id")).toBeNull();
  });

  it("all 8 Cloud plans share one seat price pair, distinct from any plan price", () => {
    process.env.STRIPE_PRICE_CLOUD_SEAT_MONTHLY = "seat_m";
    process.env.STRIPE_PRICE_CLOUD_SEAT_YEARLY = "seat_y";
    expect(seatPriceIdForPlan("pta_monthly", "month")).toBe("seat_m");
    expect(seatPriceIdForPlan("union_annual", "year")).toBe("seat_y");
    expect(isSeatPriceId("seat_m")).toBe(true);
    expect(isSeatPriceId("some-other-price")).toBe(false);
  });
});
