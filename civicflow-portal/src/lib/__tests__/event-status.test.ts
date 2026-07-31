import { describe, expect, it } from "vitest";
import { isActiveEventStatus, isCancelledEventStatus, normalizeEventStatus } from "@/lib/event-status";

describe("normalizeEventStatus", () => {
  it("maps exact canonical values to themselves", () => {
    expect(normalizeEventStatus("cancelled")).toBe("cancelled");
    expect(normalizeEventStatus("completed")).toBe("completed");
    expect(normalizeEventStatus("in_progress")).toBe("in_progress");
    expect(normalizeEventStatus("upcoming")).toBe("upcoming");
  });

  it("maps common legacy/typo'd spellings to the canonical cancelled value", () => {
    expect(normalizeEventStatus("Canceled")).toBe("cancelled");
    expect(normalizeEventStatus("CANCELLED")).toBe("cancelled");
    expect(normalizeEventStatus("  Cancel  ")).toBe("cancelled");
  });

  it("maps common legacy synonyms to completed", () => {
    expect(normalizeEventStatus("Done")).toBe("completed");
    expect(normalizeEventStatus("Finished")).toBe("completed");
  });

  it("defaults unrecognized free-text values to upcoming rather than throwing", () => {
    expect(normalizeEventStatus("Some Custom Status")).toBe("upcoming");
    expect(normalizeEventStatus("")).toBe("upcoming");
  });
});

describe("isCancelledEventStatus / isActiveEventStatus", () => {
  it("treats a typo'd cancellation as cancelled, not active — the original bug", () => {
    expect(isCancelledEventStatus("Canceled")).toBe(true);
    expect(isActiveEventStatus("Canceled")).toBe(false);
  });

  it("treats completed and cancelled events as not active", () => {
    expect(isActiveEventStatus("completed")).toBe(false);
    expect(isActiveEventStatus("cancelled")).toBe(false);
  });

  it("treats upcoming and in_progress events as active", () => {
    expect(isActiveEventStatus("upcoming")).toBe(true);
    expect(isActiveEventStatus("in_progress")).toBe(true);
  });
});
