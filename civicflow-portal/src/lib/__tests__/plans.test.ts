import { describe, expect, it } from "vitest";
import { CLOUD_PLANS, PLANS, activePlans, getPlan, isPaidPlan, planRank, plansForVertical, resolvePricingVertical, type CloudPlanId } from "@/lib/plans";

const EXPECTED: Record<CloudPlanId, { vertical: string; interval: string; cents: number }> = {
  pta_monthly: { vertical: "PTA", interval: "month", cents: 4900 },
  pta_annual: { vertical: "PTA", interval: "year", cents: 49000 },
  community_monthly: { vertical: "COMMUNITY", interval: "month", cents: 5900 },
  community_annual: { vertical: "COMMUNITY", interval: "year", cents: 59000 },
  church_monthly: { vertical: "CHURCH", interval: "month", cents: 7900 },
  church_annual: { vertical: "CHURCH", interval: "year", cents: 79000 },
  union_monthly: { vertical: "UNION", interval: "month", cents: 12900 },
  union_annual: { vertical: "UNION", interval: "year", cents: 129000 },
};

describe("Unestra Cloud plan catalog", () => {
  it("defines exactly the 8 approved price/interval combinations at the approved prices", () => {
    for (const [id, expected] of Object.entries(EXPECTED) as [CloudPlanId, (typeof EXPECTED)[CloudPlanId]][]) {
      const plan = CLOUD_PLANS[id];
      expect(plan.vertical).toBe(expected.vertical);
      expect(plan.interval).toBe(expected.interval);
      const actualCents = expected.interval === "month" ? plan.monthlyPriceCents : plan.yearlyPriceCents;
      expect(actualCents).toBe(expected.cents);
      expect(plan.active).toBe(true);
    }
  });

  it("annual pricing is exactly 10x monthly (two months free) for every vertical", () => {
    for (const vertical of ["PTA", "COMMUNITY", "CHURCH", "UNION"] as const) {
      const [monthly, annual] = plansForVertical(vertical);
      expect(annual.yearlyPriceCents).toBe(monthly.monthlyPriceCents * 10);
    }
  });

  it("grants unlimited members on every Cloud plan", () => {
    for (const plan of Object.values(CLOUD_PLANS)) {
      expect(plan.limits.members).toBe(Infinity);
    }
  });

  it("resolves HOA to COMMUNITY pricing and every other vertical to itself", () => {
    expect(resolvePricingVertical("HOA")).toBe("COMMUNITY");
    expect(resolvePricingVertical("PTA")).toBe("PTA");
    expect(resolvePricingVertical("COMMUNITY")).toBe("COMMUNITY");
    expect(resolvePricingVertical("CHURCH")).toBe("CHURCH");
    expect(resolvePricingVertical("UNION")).toBe("UNION");
  });

  it("excludes legacy plans from activePlans() but still resolves them via getPlan()", () => {
    const active = activePlans();
    expect(active).toHaveLength(8);
    expect(active.every((p) => p.active)).toBe(true);
    expect(getPlan("essential").active).toBe(false);
    expect(getPlan("elite").active).toBe(false);
    // Legacy plans keep their historically accurate member limits here —
    // CLOUD-C is what actually removes enforcement (it changes
    // checkMemberLimit/requireMemberSlot itself, not this catalog), so this
    // PR alone must not silently make legacy plans unlimited.
    expect(getPlan("essential").limits.members).toBe(500);
    expect(getPlan("free").limits.members).toBe(50);
  });

  it("plansForVertical returns exactly monthly+annual for that vertical, in that order", () => {
    const pta = plansForVertical("PTA");
    expect(pta.map((p) => p.id)).toEqual(["pta_monthly", "pta_annual"]);
  });

  it("every Cloud plan has a distinct, stable Stripe lookup key following the unestra_cloud_ convention", () => {
    const keys = Object.values(CLOUD_PLANS).map((p) => p.stripeLookupKey);
    expect(new Set(keys).size).toBe(8);
    for (const key of keys) expect(key).toMatch(/^unestra_cloud_(pta|community|church|union)_(monthly|annual)$/);
  });

  it("isPaidPlan is true for every Cloud plan and the legacy paid tiers", () => {
    for (const id of Object.keys(CLOUD_PLANS)) expect(isPaidPlan(id)).toBe(true);
    expect(isPaidPlan("essential")).toBe(true);
    expect(isPaidPlan("elite")).toBe(true);
    expect(isPaidPlan("free")).toBe(false);
  });

  it("planRank ranks every Cloud plan above the full legacy ladder", () => {
    expect(planRank("free")).toBeLessThan(planRank("essential"));
    expect(planRank("essential")).toBeLessThan(planRank("elite"));
    expect(planRank("elite")).toBeLessThan(planRank("pta_monthly"));
  });

  it("getPlan falls back to community_monthly for an unrecognized plan id", () => {
    expect(getPlan("not-a-real-plan").id).toBe("community_monthly");
  });

  it("shares one seat policy across all 8 Cloud plans (carried over from the legacy essential tier)", () => {
    for (const plan of Object.values(CLOUD_PLANS)) {
      expect(plan.includedSeats).toBe(3);
      expect(plan.additionalSeatCentsMonthly).toBe(800);
      expect(plan.seatMonthlyPriceEnvKey).toBe("STRIPE_PRICE_CLOUD_SEAT_MONTHLY");
    }
  });

  it("PLANS contains all 8 Cloud plans plus the 3 legacy plans and nothing else", () => {
    expect(Object.keys(PLANS).sort()).toEqual(
      ["church_annual", "church_monthly", "community_annual", "community_monthly", "elite", "essential", "free", "pta_annual", "pta_monthly", "union_annual", "union_monthly"].sort()
    );
  });
});
