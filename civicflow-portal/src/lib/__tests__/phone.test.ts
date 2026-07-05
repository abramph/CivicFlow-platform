import { describe, expect, it } from "vitest";
import { isValidE164Phone, normalizeToE164 } from "@/lib/phone";

describe("isValidE164Phone", () => {
  it("accepts a well-formed E.164 number", () => {
    expect(isValidE164Phone("+15551234567")).toBe(true);
  });

  it("rejects a number without a leading +", () => {
    expect(isValidE164Phone("15551234567")).toBe(false);
  });

  it("rejects a typical US-formatted member phone number", () => {
    expect(isValidE164Phone("215-917-4391")).toBe(false);
  });
});

describe("normalizeToE164", () => {
  it("leaves an already-valid E.164 number unchanged", () => {
    expect(normalizeToE164("+15551234567")).toBe("+15551234567");
  });

  it("normalizes a dashed 10-digit US number by assuming +1", () => {
    expect(normalizeToE164("215-917-4391")).toBe("+12159174391");
  });

  it("normalizes a plain 10-digit number with no separators", () => {
    expect(normalizeToE164("2159174391")).toBe("+12159174391");
  });

  it("normalizes a parenthesized/spaced US number", () => {
    expect(normalizeToE164("(215) 917-4391")).toBe("+12159174391");
  });

  it("normalizes an 11-digit number already prefixed with a US country code", () => {
    expect(normalizeToE164("12159174391")).toBe("+12159174391");
  });

  it("returns null for a number that's too short to be plausible", () => {
    expect(normalizeToE164("12345")).toBeNull();
  });

  it("returns null for non-numeric junk", () => {
    expect(normalizeToE164("not-a-phone")).toBeNull();
  });
});
