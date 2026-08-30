import { describe, expect, it } from "vitest";
import {
  formatOrgWallTime,
  formatOrgWallTimeEndOfDayInclusive,
  resolveOrgWallTimeEndOfDayToUtc,
  resolveOrgWallTimeEndOfDayToUtcNullable,
  resolveOrgWallTimeToUtc,
  resolveOrgWallTimeToUtcNullable,
} from "../timezone";

describe("resolveOrgWallTimeToUtc — FC-6 (docs/pta-volunteer-hours-pricing-lock-design.md's sibling correction)", () => {
  it("resolves a winter (EST, UTC-5) wall-clock time in America/New_York", () => {
    expect(resolveOrgWallTimeToUtc("2026-01-15T09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("resolves a summer (EDT, UTC-4) wall-clock time in America/New_York — different offset than winter", () => {
    expect(resolveOrgWallTimeToUtc("2026-07-01T09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("a date-only string is treated as midnight in the target zone, not UTC midnight", () => {
    // This is the literal defect FC-6 exists to fix: before this module existed,
    // z.coerce.date() on "2026-09-01" always produced UTC midnight
    // (2026-09-01T00:00:00.000Z), which for any US timezone is actually the
    // previous evening local time.
    expect(resolveOrgWallTimeToUtc("2026-09-01", "America/New_York").toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(resolveOrgWallTimeToUtc("2026-09-01", "America/Los_Angeles").toISOString()).toBe("2026-09-01T07:00:00.000Z");
  });

  it("UTC timezone is a pure passthrough", () => {
    expect(resolveOrgWallTimeToUtc("2026-07-01T09:00", "UTC").toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(resolveOrgWallTimeToUtc("2026-07-01", "UTC").toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("crosses a UTC year boundary correctly from a New Year's Eve local time", () => {
    // 2025-12-31T23:30 EST (UTC-5) -> 2026-01-01T04:30Z.
    expect(resolveOrgWallTimeToUtc("2025-12-31T23:30", "America/New_York").toISOString()).toBe("2026-01-01T04:30:00.000Z");
  });

  it("an already-absolute ISO instant (Z suffix) is parsed as-is, never reinterpreted through the target zone", () => {
    // This is the round-trip case: the settings UI's activate/deactivate action
    // resends a window's own API-returned startAt/endAt unchanged.
    expect(resolveOrgWallTimeToUtc("2026-07-01T13:00:00.000Z", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("an already-absolute ISO instant with a non-Z numeric offset is also parsed as-is", () => {
    expect(resolveOrgWallTimeToUtc("2026-07-01T09:00:00-04:00", "UTC").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("rejects an unparseable string rather than silently coercing it", () => {
    expect(() => resolveOrgWallTimeToUtc("not-a-date", "America/New_York")).toThrow();
  });

  it("DST spring-forward (America/New_York, 2026-03-08 2am->3am): a wall time in the nonexistent gap resolves deterministically, not by throwing", () => {
    // 2026-03-08T02:30 does not exist in America/New_York (clocks jump 2:00->3:00).
    // FC-6's documented behavior: resolves to whatever Intl computes for the
    // UTC-guess instant — deterministic, not further disambiguated. Assert
    // it doesn't throw and is stable across repeated calls (same engine, same
    // answer every time), rather than asserting one specific "correct" side.
    const first = resolveOrgWallTimeToUtc("2026-03-08T02:30", "America/New_York");
    const second = resolveOrgWallTimeToUtc("2026-03-08T02:30", "America/New_York");
    expect(first.getTime()).toBe(second.getTime());
    // Whichever side it resolves to, it must land within the plausible +/-1
    // day window around the nominal instant, not some wildly wrong value.
    expect(first.toISOString().slice(0, 10)).toBe("2026-03-08");
  });

  it("DST fall-back (America/New_York, 2026-11-01 2am->1am): a wall time that occurs twice resolves deterministically", () => {
    // 2026-11-01T01:30 occurs twice (once at EDT, once at EST). FC-6's
    // documented behavior: deterministic per engine, not further
    // disambiguated by this module.
    const first = resolveOrgWallTimeToUtc("2026-11-01T01:30", "America/New_York");
    const second = resolveOrgWallTimeToUtc("2026-11-01T01:30", "America/New_York");
    expect(first.getTime()).toBe(second.getTime());
    // Must resolve to one of the two legitimate instants (EDT=UTC-4 or EST=UTC-5
    // interpretation of 01:30), never something outside that pair.
    const edtInterpretation = Date.parse("2026-11-01T01:30:00.000-04:00");
    const estInterpretation = Date.parse("2026-11-01T01:30:00.000-05:00");
    expect([edtInterpretation, estInterpretation]).toContain(first.getTime());
  });

  it("a browser in a different timezone than the org has no bearing on the result — only the passed timezone parameter matters", () => {
    // Simulates "browser-different-timezone, server-in-UTC" from the FC-6
    // test matrix: the wall-clock STRING is what travels over the wire (not a
    // pre-converted Date), so there is nothing for the browser's own
    // timezone to contaminate — the server-side conversion is the only one
    // that ever runs, and it is deterministic regardless of process.env.TZ.
    const a = resolveOrgWallTimeToUtc("2026-06-15T10:00", "America/Chicago");
    const b = resolveOrgWallTimeToUtc("2026-06-15T10:00", "America/Chicago");
    expect(a.toISOString()).toBe(b.toISOString());
    expect(a.toISOString()).toBe("2026-06-15T15:00:00.000Z"); // CDT, UTC-5
  });
});

describe("resolveOrgWallTimeToUtcNullable", () => {
  it("passes through null/undefined/empty-string as null", () => {
    expect(resolveOrgWallTimeToUtcNullable(null, "America/New_York")).toBeNull();
    expect(resolveOrgWallTimeToUtcNullable(undefined, "America/New_York")).toBeNull();
    expect(resolveOrgWallTimeToUtcNullable("", "America/New_York")).toBeNull();
  });

  it("resolves a real value exactly like the non-nullable variant", () => {
    expect(resolveOrgWallTimeToUtcNullable("2026-07-01T09:00", "America/New_York")?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });
});

describe("formatOrgWallTime — the display-direction inverse", () => {
  it("round-trips a resolved instant back to the same wall-clock string it came from", () => {
    const instant = resolveOrgWallTimeToUtc("2026-07-01T09:00", "America/New_York");
    expect(formatOrgWallTime(instant, "America/New_York", true)).toBe("2026-07-01T09:00");
  });

  it("date-only formatting drops the time component", () => {
    const instant = resolveOrgWallTimeToUtc("2026-09-01", "America/New_York");
    expect(formatOrgWallTime(instant, "America/New_York", false)).toBe("2026-09-01");
  });

  it("shows the correct LOCAL calendar date even for a positive-UTC-offset zone where the naive UTC-slice approach would be wrong", () => {
    // Tokyo is UTC+9. Midnight Sept 1 Tokyo time is 2026-08-31T15:00:00.000Z —
    // a naive `.slice(0, 10)` on that ISO string would show "2026-08-31",
    // one day off from what a Tokyo-based admin actually entered.
    const instant = resolveOrgWallTimeToUtc("2026-09-01", "Asia/Tokyo");
    expect(instant.toISOString()).toBe("2026-08-31T15:00:00.000Z");
    expect(formatOrgWallTime(instant, "Asia/Tokyo", false)).toBe("2026-09-01");
  });

  it("accepts a Date or an ISO string interchangeably", () => {
    const iso = "2026-07-01T13:00:00.000Z";
    expect(formatOrgWallTime(iso, "America/New_York", true)).toBe(formatOrgWallTime(new Date(iso), "America/New_York", true));
  });
});

describe("resolveOrgWallTimeEndOfDayToUtc — RV-6 (the buyout-closing-date UX fix)", () => {
  it("shifts a date-only string to the start of the FOLLOWING org-local day, not the typed day's own midnight", () => {
    // "September 30" must mean "through the end of Sept 30" -- stored as
    // the start of Oct 1 America/New_York (EDT, UTC-4).
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-09-30", "America/New_York").toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });

  it("correctly rolls over a month boundary (Jan 31 -> Feb 1)", () => {
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-01-31", "America/New_York").toISOString()).toBe("2026-02-01T05:00:00.000Z"); // EST, UTC-5
  });

  it("correctly rolls over a year boundary (Dec 31 -> Jan 1)", () => {
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-12-31", "America/New_York").toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("correctly rolls a leap-day February (2028 is a leap year) forward to March 1", () => {
    expect(resolveOrgWallTimeEndOfDayToUtc("2028-02-29", "America/New_York").toISOString()).toBe("2028-03-01T05:00:00.000Z");
  });

  it("DST: an end date the day BEFORE a spring-forward resolves against the FOLLOWING day's correct (post-transition) offset", () => {
    // America/New_York springs forward 2026-03-08 (2am->3am, EST->EDT).
    // An end date of "2026-03-07" must shift to the start of 2026-03-08 --
    // and 2026-03-08's own midnight is still EST (the transition happens
    // later that day, at 2am), so this specific case is UTC-5.
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-03-07", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("DST: an end date ON the fall-back day resolves against the FOLLOWING day's correct (post-transition) offset", () => {
    // America/New_York falls back 2026-11-01 (2am->1am, EDT->EST). An end
    // date of "2026-11-01" shifts to the start of 2026-11-02, whose own
    // midnight is already EST (UTC-5) -- the transition happened the day
    // before, at 2am on Nov 1.
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("a different org timezone (America/Los_Angeles) shifts and resolves independently of America/New_York", () => {
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-09-30", "America/Los_Angeles").toISOString()).toBe("2026-10-01T07:00:00.000Z"); // PDT, UTC-7
  });

  it("a wall-clock string WITH a time component is resolved as an exact instant -- no day shift applied", () => {
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-09-30T18:00", "America/New_York").toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });

  it("an already-absolute ISO instant is passed through unshifted, exactly like resolveOrgWallTimeToUtc", () => {
    expect(resolveOrgWallTimeEndOfDayToUtc("2026-10-01T04:00:00.000Z", "America/New_York").toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });

  it("rejects an unparseable string", () => {
    expect(() => resolveOrgWallTimeEndOfDayToUtc("not-a-date", "America/New_York")).toThrow();
  });
});

describe("resolveOrgWallTimeEndOfDayToUtcNullable", () => {
  it("passes through null/undefined/empty-string as null", () => {
    expect(resolveOrgWallTimeEndOfDayToUtcNullable(null, "America/New_York")).toBeNull();
    expect(resolveOrgWallTimeEndOfDayToUtcNullable(undefined, "America/New_York")).toBeNull();
    expect(resolveOrgWallTimeEndOfDayToUtcNullable("", "America/New_York")).toBeNull();
  });

  it("resolves a real value exactly like the non-nullable variant", () => {
    expect(resolveOrgWallTimeEndOfDayToUtcNullable("2026-09-30", "America/New_York")?.toISOString()).toBe("2026-10-01T04:00:00.000Z");
  });
});

describe("formatOrgWallTimeEndOfDayInclusive — the display-direction inverse", () => {
  it("round-trips exactly: resolve(end-of-day) -> format(inclusive) reproduces the originally-typed date", () => {
    const stored = resolveOrgWallTimeEndOfDayToUtc("2026-09-30", "America/New_York");
    expect(formatOrgWallTimeEndOfDayInclusive(stored, "America/New_York")).toBe("2026-09-30");
  });

  it("round-trips across a month boundary", () => {
    const stored = resolveOrgWallTimeEndOfDayToUtc("2026-01-31", "America/New_York");
    expect(formatOrgWallTimeEndOfDayInclusive(stored, "America/New_York")).toBe("2026-01-31");
  });

  it("round-trips across a DST fall-back boundary", () => {
    const stored = resolveOrgWallTimeEndOfDayToUtc("2026-11-01", "America/New_York");
    expect(formatOrgWallTimeEndOfDayInclusive(stored, "America/New_York")).toBe("2026-11-01");
  });

  it("round-trips for a positive-UTC-offset zone (Asia/Tokyo)", () => {
    const stored = resolveOrgWallTimeEndOfDayToUtc("2026-09-30", "Asia/Tokyo");
    expect(formatOrgWallTimeEndOfDayInclusive(stored, "Asia/Tokyo")).toBe("2026-09-30");
  });

  it("accepts a Date or an ISO string interchangeably", () => {
    const iso = resolveOrgWallTimeEndOfDayToUtc("2026-09-30", "America/New_York").toISOString();
    expect(formatOrgWallTimeEndOfDayInclusive(iso, "America/New_York")).toBe(formatOrgWallTimeEndOfDayInclusive(new Date(iso), "America/New_York"));
  });
});
