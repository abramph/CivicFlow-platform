import { describe, expect, it } from "vitest";
import { calculateProcessingCostCoverageCents, resolveCoverageSplit } from "@/lib/giving/processing-cost-coverage";

describe("calculateProcessingCostCoverageCents — gross-up math (§30)", () => {
  it("returns 0 when the org has configured no rate at all (never a hidden default)", () => {
    expect(calculateProcessingCostCoverageCents(10000, 0, 0)).toBe(0);
  });

  it("returns 0 for a non-positive base amount", () => {
    expect(calculateProcessingCostCoverageCents(0, 290, 30)).toBe(0);
    expect(calculateProcessingCostCoverageCents(-500, 290, 30)).toBe(0);
  });

  it("gross = ceil((net + fixed) / (1 - p)) — a realistic 2.9% + 30¢ rate on $100", () => {
    // gross = ceil((10000 + 30) / (1 - 0.029)) = ceil(10030 / 0.971) = ceil(10329.55) = 10330
    expect(calculateProcessingCostCoverageCents(10000, 290, 30)).toBe(330);
  });

  it("percent-only rate", () => {
    // gross = ceil(10000 / (1 - 0.05)) = ceil(10526.3) = 10527
    expect(calculateProcessingCostCoverageCents(10000, 500, 0)).toBe(527);
  });

  it("fixed-only rate is a flat add-on", () => {
    expect(calculateProcessingCostCoverageCents(10000, 0, 30)).toBe(30);
  });

  it("never divides by zero or goes negative even if percentBps is fat-fingered to >=10000", () => {
    const result = calculateProcessingCostCoverageCents(10000, 15000, 0);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });

  it("always returns an integer number of cents", () => {
    const result = calculateProcessingCostCoverageCents(3333, 290, 30);
    expect(Number.isInteger(result)).toBe(true);
  });
});

describe("resolveCoverageSplit — webhook-side reconciliation against provider truth", () => {
  it("no metadata at all → full amount is base, 0 coverage (pre-CONNECT-F behavior)", () => {
    expect(resolveCoverageSplit(10000, null, null)).toEqual({ baseAmountCents: 10000, coverageAmountCents: 0 });
    expect(resolveCoverageSplit(10000, undefined, undefined)).toEqual({ baseAmountCents: 10000, coverageAmountCents: 0 });
  });

  it("a consistent split is accepted verbatim", () => {
    expect(resolveCoverageSplit(10330, 10000, 330)).toEqual({ baseAmountCents: 10000, coverageAmountCents: 330 });
  });

  it("zero coverage with base metadata present is still accepted (coverage offered but declined)", () => {
    expect(resolveCoverageSplit(10000, 10000, 0)).toEqual({ baseAmountCents: 10000, coverageAmountCents: 0 });
  });

  it("a split that doesn't sum to the provider total is rejected", () => {
    expect(resolveCoverageSplit(10330, 10000, 999)).toEqual({ baseAmountCents: null, coverageAmountCents: 0 });
  });

  it("a non-positive or non-integer base is rejected", () => {
    expect(resolveCoverageSplit(100, 0, 100)).toEqual({ baseAmountCents: null, coverageAmountCents: 0 });
    expect(resolveCoverageSplit(100.5, 100, 0.5)).toEqual({ baseAmountCents: null, coverageAmountCents: 0 });
  });

  it("a negative coverage is rejected even if the sum happens to match", () => {
    expect(resolveCoverageSplit(9000, 10000, -1000)).toEqual({ baseAmountCents: null, coverageAmountCents: 0 });
  });
});
