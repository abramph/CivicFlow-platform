import { describe, expect, it } from "vitest";
import { isValidEmail, parseImportEmail } from "@/lib/email";

describe("isValidEmail", () => {
  it.each(["jane@example.com", "Jane.Doe+tag@sub.example.co"])("accepts a well-formed address: %s", (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each(["not-an-email", "jane@", "@example.com", "jane@example", "jane example.com", ""])(
    "rejects a malformed address: %s",
    (value) => {
      expect(isValidEmail(value)).toBe(false);
    }
  );
});

describe("parseImportEmail", () => {
  it("returns null/null for a blank field (no email is not an error)", () => {
    expect(parseImportEmail("")).toEqual({ email: null, error: null });
    expect(parseImportEmail(null)).toEqual({ email: null, error: null });
    expect(parseImportEmail(undefined)).toEqual({ email: null, error: null });
    expect(parseImportEmail("   ")).toEqual({ email: null, error: null });
  });

  it("trims and lowercases a valid address without otherwise altering it", () => {
    expect(parseImportEmail("  Jane.Doe@Example.COM  ")).toEqual({ email: "jane.doe@example.com", error: null });
  });

  it("rejects a malformed address with an explicit error, never guessing a corrected value", () => {
    const result = parseImportEmail("not-an-email");
    expect(result.email).toBeNull();
    expect(result.error).toContain("not-an-email");
  });
});
