import { describe, expect, it } from "vitest";
import { centsToDollarsDisplay, estimateMeetingCostCents, estimateMonthlyCostCents } from "../cost-model";

describe("estimateMeetingCostCents", () => {
  it("returns a positive total for a 15/30/60/90 minute meeting, increasing with duration", () => {
    const durations = [15, 30, 60, 90];
    const totals = durations.map((minutes) => estimateMeetingCostCents(minutes * 60_000, "assemblyai").totalCents);
    expect(totals.every((t) => t > 0)).toBe(true);
    for (let i = 1; i < totals.length; i += 1) {
      expect(totals[i]).toBeGreaterThan(totals[i - 1]);
    }
  });

  it("total is the sum of its own component breakdown", () => {
    const breakdown = estimateMeetingCostCents(60 * 60_000, "openai");
    const sum = breakdown.transcriptionCents + breakdown.summarizationCents + breakdown.storageCents + breakdown.bandwidthCents;
    expect(breakdown.totalCents).toBeCloseTo(sum, 5);
  });

  it("differs between providers (openai vs assemblyai) since their per-minute rates differ", () => {
    const openai = estimateMeetingCostCents(60 * 60_000, "openai").transcriptionCents;
    const assemblyai = estimateMeetingCostCents(60 * 60_000, "assemblyai").transcriptionCents;
    expect(openai).not.toBeCloseTo(assemblyai, 5);
  });
});

describe("estimateMonthlyCostCents", () => {
  it("scales linearly with meetings per month at a fixed average duration", () => {
    const at100 = estimateMonthlyCostCents(100, 45, "assemblyai").totalCents;
    const at500 = estimateMonthlyCostCents(500, 45, "assemblyai").totalCents;
    const at1000 = estimateMonthlyCostCents(1000, 45, "assemblyai").totalCents;
    const at5000 = estimateMonthlyCostCents(5000, 45, "assemblyai").totalCents;
    expect(at500).toBeCloseTo(at100 * 5, 2);
    expect(at1000).toBeCloseTo(at100 * 10, 2);
    expect(at5000).toBeCloseTo(at100 * 50, 2);
  });

  it("preserves the requested volume/duration on the returned object for display", () => {
    const estimate = estimateMonthlyCostCents(500, 45, "assemblyai");
    expect(estimate.meetingsPerMonth).toBe(500);
    expect(estimate.avgDurationMinutes).toBe(45);
  });
});

describe("centsToDollarsDisplay", () => {
  it("formats cents as a two-decimal dollar string", () => {
    expect(centsToDollarsDisplay(150)).toBe("$1.50");
    expect(centsToDollarsDisplay(5)).toBe("$0.05");
    expect(centsToDollarsDisplay(0)).toBe("$0.00");
  });
});
