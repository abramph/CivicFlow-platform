import { beforeEach, describe, expect, it, vi } from "vitest";

const createLabUsageEvent = vi.fn().mockResolvedValue({ id: "usage-1" });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    labUsageEvent: { create: (...args: unknown[]) => createLabUsageEvent(...args) },
  },
}));

beforeEach(() => {
  createLabUsageEvent.mockClear();
});

describe("recordLabUsage", () => {
  it("records a valid usage event", async () => {
    const { recordLabUsage } = await import("../usage");
    await recordLabUsage({
      organizationId: "org-1",
      featureKey: "meetingIntelligence",
      unit: "audio_minutes",
      quantity: 12.5,
      metadata: { meetingId: "meeting-1", source: "upload" },
    });

    expect(createLabUsageEvent).toHaveBeenCalledWith({
      data: {
        organizationId: "org-1",
        featureKey: "meetingIntelligence",
        unit: "audio_minutes",
        quantity: 12.5,
        metadata: { meetingId: "meeting-1", source: "upload" },
      },
    });
  });

  it("rejects an unknown feature key rather than silently recording it", async () => {
    const { recordLabUsage } = await import("../usage");
    await expect(
      recordLabUsage({
        organizationId: "org-1",
        featureKey: "notARealFeature" as never,
        unit: "audio_minutes",
        quantity: 1,
      })
    ).rejects.toThrow(/unknown Labs feature key/i);
    expect(createLabUsageEvent).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative quantity", async () => {
    const { recordLabUsage } = await import("../usage");
    await expect(
      recordLabUsage({ organizationId: "org-1", featureKey: "meetingIntelligence", unit: "audio_minutes", quantity: 0 })
    ).rejects.toThrow(/positive/i);
    await expect(
      recordLabUsage({ organizationId: "org-1", featureKey: "meetingIntelligence", unit: "audio_minutes", quantity: -5 })
    ).rejects.toThrow(/positive/i);
    expect(createLabUsageEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-finite quantity (NaN/Infinity)", async () => {
    const { recordLabUsage } = await import("../usage");
    await expect(
      recordLabUsage({ organizationId: "org-1", featureKey: "meetingIntelligence", unit: "audio_minutes", quantity: Number.NaN })
    ).rejects.toThrow();
    await expect(
      recordLabUsage({ organizationId: "org-1", featureKey: "meetingIntelligence", unit: "audio_minutes", quantity: Infinity })
    ).rejects.toThrow();
  });

  it("cross-tenant rejection: each call is scoped to exactly the organizationId passed, never a shared/global counter", async () => {
    const { recordLabUsage } = await import("../usage");
    await recordLabUsage({ organizationId: "org-a", featureKey: "meetingIntelligence", unit: "audio_minutes", quantity: 5 });
    await recordLabUsage({ organizationId: "org-b", featureKey: "meetingIntelligence", unit: "audio_minutes", quantity: 5 });

    expect(createLabUsageEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a" }) }));
    expect(createLabUsageEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-b" }) }));
  });

  it("accepts metadata with only primitive values, matching the LabUsageMetadata type", async () => {
    const { recordLabUsage } = await import("../usage");
    await recordLabUsage({
      organizationId: "org-1",
      featureKey: "meetingIntelligence",
      unit: "meetings_processed",
      quantity: 1,
      metadata: { count: 1, label: "test", flagged: false, nothing: null },
    });
    expect(createLabUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metadata: { count: 1, label: "test", flagged: false, nothing: null } }) })
    );
  });

  it("records without metadata when none is provided", async () => {
    const { recordLabUsage } = await import("../usage");
    await recordLabUsage({ organizationId: "org-1", featureKey: "meetingIntelligence", unit: "audio_minutes", quantity: 3 });
    expect(createLabUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metadata: undefined }) })
    );
  });
});
