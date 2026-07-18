import { describe, expect, it } from "vitest";
import {
  LAB_LIFECYCLE,
  findLabFeature,
  getLabFeature,
  isLabFeatureKey,
  listLabFeatures,
} from "../registry";

describe("Labs feature registry", () => {
  it("resolves a valid typed feature key", () => {
    const feature = getLabFeature("labsFrameworkPreview");
    expect(feature.key).toBe("labsFrameworkPreview");
    expect(feature.name).toBeTruthy();
  });

  it("rejects an unknown feature key via isLabFeatureKey", () => {
    expect(isLabFeatureKey("notARealFeature")).toBe(false);
    expect(isLabFeatureKey("labsFrameworkPreview")).toBe(true);
  });

  it("findLabFeature returns undefined (not a throw) for an unknown key", () => {
    expect(findLabFeature("notARealFeature")).toBeUndefined();
  });

  it("every registered feature has a lifecycle from the recommended set", () => {
    for (const feature of listLabFeatures()) {
      expect(LAB_LIFECYCLE).toContain(feature.lifecycle);
    }
  });

  it("no reserved placeholder feature is RETIRED, and every reserved Labs-capability placeholder is internal-only and un-advertised", () => {
    const placeholders = ["meetingIntelligence", "aiAnnouncements", "policyAssistant", "executiveCopilot", "workflowAutomation"] as const;
    for (const key of placeholders) {
      const feature = getLabFeature(key);
      expect(feature.lifecycle).not.toBe("RETIRED");
      expect(feature.lifecycle).toBe("INTERNAL");
      expect(feature.internalOnly).toBe(true);
    }
  });

  it("labsFrameworkPreview is internal-only, requires enrollment, and requires no plan entitlement", () => {
    const feature = getLabFeature("labsFrameworkPreview");
    expect(feature.internalOnly).toBe(true);
    expect(feature.requiresEnrollment).toBe(true);
    expect(feature.requiresEntitlement).toBe(false);
    expect(feature.metered).toBe(false);
  });

  it("handles a hypothetical RETIRED feature lookup correctly (lifecycle recognized, not a registry crash)", () => {
    // No feature is actually retired today — this asserts the lifecycle
    // value itself round-trips through the type, since we can't mutate the
    // real registry from a test.
    expect(LAB_LIFECYCLE).toContain("RETIRED");
  });

  it("listLabFeatures returns every registered feature with no duplicates", () => {
    const features = listLabFeatures();
    const keys = features.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "labsFrameworkPreview",
        "meetingIntelligence",
        "aiAnnouncements",
        "policyAssistant",
        "executiveCopilot",
        "workflowAutomation",
      ])
    );
  });
});
