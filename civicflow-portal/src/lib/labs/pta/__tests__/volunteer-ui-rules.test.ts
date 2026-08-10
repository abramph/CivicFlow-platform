import { describe, expect, it } from "vitest";
import { canDeleteShift, canCancelShift, canRemoveSignup, canSaveSlotCapacity, canClaimSlot, canCancelSignup } from "../volunteer-ui-rules";

describe("canDeleteShift — must match deletePtaVolunteerSlot()'s guard exactly", () => {
  it("allows delete when the shift has no signup history at all", () => {
    expect(canDeleteShift(0)).toBe(true);
  });

  it("refuses delete once any signup exists, even a single cancelled one — the real bug found live in production", () => {
    expect(canDeleteShift(1)).toBe(false);
  });
});

describe("canCancelShift — the alternative deletePtaVolunteerSlot()'s own error message points to", () => {
  it("offers cancel when the shift has signup history and isn't already cancelled", () => {
    expect(canCancelShift(1, "OPEN")).toBe(true);
    expect(canCancelShift(3, "CLOSED")).toBe(true);
  });

  it("never offers cancel when there's no signup history (delete already covers that case)", () => {
    expect(canCancelShift(0, "OPEN")).toBe(false);
  });

  it("never offers cancel on an already-cancelled shift", () => {
    expect(canCancelShift(2, "CANCELLED")).toBe(false);
  });
});

describe("canRemoveSignup — must match cancelPtaVolunteerSignup()'s silent-no-op guard exactly", () => {
  it("allows Remove only for an active SIGNED_UP signup", () => {
    expect(canRemoveSignup("SIGNED_UP")).toBe(true);
  });

  it.each(["ATTENDED", "PARTIAL", "NO_SHOW", "EXCUSED", "COMPLETED", "CANCELLED", "WAITLISTED"])(
    "refuses Remove for a %s signup — the server would silently no-op, not actually remove it",
    (status) => {
      expect(canRemoveSignup(status)).toBe(false);
    }
  );
});

describe("canSaveSlotCapacity — must match updatePtaVolunteerSlot()'s guard exactly", () => {
  it("allows a capacity at or above the number already assigned", () => {
    expect(canSaveSlotCapacity(3, 3)).toBe(true);
    expect(canSaveSlotCapacity(5, 3)).toBe(true);
    expect(canSaveSlotCapacity(1, 0)).toBe(true);
  });

  it("refuses a capacity below the number already assigned — the real bug: the form's HTML `min` attribute was never enforced without a <form> submit", () => {
    expect(canSaveSlotCapacity(2, 3)).toBe(false);
  });

  it("refuses non-positive or non-integer capacity", () => {
    expect(canSaveSlotCapacity(0, 0)).toBe(false);
    expect(canSaveSlotCapacity(-1, 0)).toBe(false);
    expect(canSaveSlotCapacity(1.5, 0)).toBe(false);
    expect(canSaveSlotCapacity(NaN, 0)).toBe(false);
  });
});

describe("canClaimSlot — must match claimPtaVolunteerSlot()'s guards not already covered by the page-level OPEN-opportunity filter", () => {
  it("allows claiming an open, unfilled slot before the signup deadline", () => {
    expect(canClaimSlot({ slotStatus: "OPEN", full: false, signupDeadlinePassed: false })).toBe(true);
  });

  it("refuses when the individual slot is closed or cancelled, even though the parent opportunity is OPEN", () => {
    expect(canClaimSlot({ slotStatus: "CLOSED", full: false, signupDeadlinePassed: false })).toBe(false);
    expect(canClaimSlot({ slotStatus: "CANCELLED", full: false, signupDeadlinePassed: false })).toBe(false);
  });

  it("refuses once the signup deadline has passed, even with open seats", () => {
    expect(canClaimSlot({ slotStatus: "OPEN", full: false, signupDeadlinePassed: true })).toBe(false);
  });

  it("refuses when full", () => {
    expect(canClaimSlot({ slotStatus: "OPEN", full: true, signupDeadlinePassed: false })).toBe(false);
  });
});

describe("canCancelSignup — must match cancelPtaVolunteerSignup()'s member-path cancellation-deadline guard", () => {
  it("allows cancelling before the cancellation deadline", () => {
    expect(canCancelSignup(false)).toBe(true);
  });

  it("refuses cancelling once the cancellation deadline has passed", () => {
    expect(canCancelSignup(true)).toBe(false);
  });
});
