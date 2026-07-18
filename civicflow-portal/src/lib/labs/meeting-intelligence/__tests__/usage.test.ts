import { beforeEach, describe, expect, it, vi } from "vitest";

const recordLabUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/usage", () => ({
  recordLabUsage: (...args: unknown[]) => recordLabUsage(...args),
}));

beforeEach(() => {
  recordLabUsage.mockClear();
});

describe("recordMeetingIntelligenceUsage", () => {
  it("composes the generic Labs usage interface with meetingIntelligence-specific metadata", async () => {
    const { recordMeetingIntelligenceUsage } = await import("../usage");
    await recordMeetingIntelligenceUsage({
      organizationId: "aph-org",
      providerId: "assemblyai",
      durationMs: 30 * 60_000,
      processingMs: 4500,
      estimatedCostCents: 13.5,
    });

    expect(recordLabUsage).toHaveBeenCalledWith({
      organizationId: "aph-org",
      featureKey: "meetingIntelligence",
      unit: "audio_minutes",
      quantity: 30,
      metadata: { provider: "assemblyai", processingMs: 4500, estimatedCostCents: 14 },
    });
  });

  it("never includes transcript text, prompts, or recording content in the metadata — only counts/identifiers", async () => {
    const { recordMeetingIntelligenceUsage } = await import("../usage");
    await recordMeetingIntelligenceUsage({
      organizationId: "aph-org",
      providerId: "openai",
      durationMs: 60_000,
      processingMs: 1000,
      estimatedCostCents: 1,
    });
    const call = recordLabUsage.mock.calls[0][0];
    const metadataKeys = Object.keys(call.metadata);
    expect(metadataKeys.sort()).toEqual(["estimatedCostCents", "processingMs", "provider"]);
  });
});
