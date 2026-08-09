import { describe, expect, it } from "vitest";
import { canDeleteShift, canCancelShift, canRemoveSignup } from "../volunteer-ui-rules";

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
