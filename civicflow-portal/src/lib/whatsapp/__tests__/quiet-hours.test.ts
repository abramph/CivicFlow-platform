import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "@/lib/whatsapp/quiet-hours";

describe("isWithinQuietHours", () => {
  const TZ = "America/New_York";

  it("is quiet late at night, inside an overnight-wrapping window (21-8)", () => {
    // 2026-01-15T02:00:00Z = 9pm ET on 2026-01-14 — inside [21, 8).
    expect(isWithinQuietHours(new Date("2026-01-15T02:00:00Z"), TZ, 21, 8)).toBe(true);
  });

  it("is quiet early in the morning, inside an overnight-wrapping window (21-8)", () => {
    // 2026-01-15T10:00:00Z = 5am ET — inside [21, 8).
    expect(isWithinQuietHours(new Date("2026-01-15T10:00:00Z"), TZ, 21, 8)).toBe(true);
  });

  it("is not quiet mid-morning, outside an overnight-wrapping window (21-8)", () => {
    // 2026-01-15T15:00:00Z = 10am ET — outside [21, 8).
    expect(isWithinQuietHours(new Date("2026-01-15T15:00:00Z"), TZ, 21, 8)).toBe(false);
  });

  it("is not quiet exactly at the end boundary (endHour is exclusive)", () => {
    // 2026-01-15T13:00:00Z = 8am ET exactly.
    expect(isWithinQuietHours(new Date("2026-01-15T13:00:00Z"), TZ, 21, 8)).toBe(false);
  });

  it("is quiet exactly at the start boundary (startHour is inclusive)", () => {
    // 2026-01-15T02:00:00Z = 9pm ET exactly.
    expect(isWithinQuietHours(new Date("2026-01-15T02:00:00Z"), TZ, 21, 8)).toBe(true);
  });

  it("handles a same-day (non-wrapping) window correctly", () => {
    // Quiet from 1pm to 3pm ET, same day.
    expect(isWithinQuietHours(new Date("2026-01-15T18:00:00Z"), TZ, 13, 15)).toBe(true); // 1pm ET
    expect(isWithinQuietHours(new Date("2026-01-15T21:00:00Z"), TZ, 13, 15)).toBe(false); // 4pm ET
  });

  it("treats a zero-width window (startHour === endHour) as quiet hours effectively off", () => {
    expect(isWithinQuietHours(new Date("2026-01-15T02:00:00Z"), TZ, 21, 21)).toBe(false);
  });

  it("respects a different timezone independently", () => {
    // 2026-01-15T02:00:00Z = 6pm PT (America/Los_Angeles) the prior day — outside [21, 8).
    expect(isWithinQuietHours(new Date("2026-01-15T02:00:00Z"), "America/Los_Angeles", 21, 8)).toBe(false);
  });
});
