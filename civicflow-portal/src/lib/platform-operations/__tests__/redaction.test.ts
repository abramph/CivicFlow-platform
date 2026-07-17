import { describe, expect, it } from "vitest";
import { isSensitiveKey, redactSensitiveFields, redactAuditMetadata } from "../redaction";

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "passwordHash",
    "secret",
    "apiKey",
    "api_key",
    "authToken",
    "credential",
    "cookie",
    "session",
    "signature",
    "webhookSecret",
    "clientSecret",
    "accessToken",
    "refreshToken",
    "STRIPE_SECRET_KEY",
  ])("flags %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["userId", "role", "status", "reason", "email", "organizationId", "createdAt"])(
    "does not flag %s as sensitive",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    }
  );
});

describe("redactSensitiveFields", () => {
  it("redacts a top-level sensitive field", () => {
    const result = redactSensitiveFields({ userId: "u1", password: "hunter2" });
    expect(result).toEqual({ userId: "u1", password: "[redacted]" });
  });

  it("redacts sensitive fields nested inside objects", () => {
    const result = redactSensitiveFields({
      grant: { userId: "u1", accessToken: "abc123" },
    });
    expect(result).toEqual({ grant: { userId: "u1", accessToken: "[redacted]" } });
  });

  it("redacts sensitive fields inside arrays of objects", () => {
    const result = redactSensitiveFields([{ token: "t1" }, { userId: "u2" }]);
    expect(result).toEqual([{ token: "[redacted]" }, { userId: "u2" }]);
  });

  it("leaves non-sensitive primitive values untouched", () => {
    expect(redactSensitiveFields("hello")).toBe("hello");
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(null)).toBe(null);
    expect(redactSensitiveFields(true)).toBe(true);
  });

  it("does not mutate the input", () => {
    const input = { password: "hunter2" };
    redactSensitiveFields(input);
    expect(input.password).toBe("hunter2");
  });

  it("bails out safely on pathologically deep nesting rather than recursing forever", () => {
    let deep: unknown = { password: "leaf" };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    const result = redactSensitiveFields(deep);
    expect(JSON.stringify(result)).toContain("max depth exceeded");
  });
});

describe("redactAuditMetadata", () => {
  it("passes null and undefined through unchanged", () => {
    expect(redactAuditMetadata(null)).toBe(null);
    expect(redactAuditMetadata(undefined)).toBe(undefined);
  });

  it("redacts a realistic PlatformAccess audit payload", () => {
    const before = { status: "ACTIVE", reason: "onboarding" };
    const after = { status: "SUSPENDED", reason: "investigation", revokedById: "u2" };
    expect(redactAuditMetadata(before)).toEqual(before);
    expect(redactAuditMetadata(after)).toEqual(after);
  });

  it("redacts a payload that accidentally includes a secret-shaped field", () => {
    const result = redactAuditMetadata({ accountSid: "AC123", authToken: "should-not-leak" });
    expect(result).toEqual({ accountSid: "AC123", authToken: "[redacted]" });
  });
});
