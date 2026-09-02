import { describe, expect, it } from "vitest";
import { assertSafeEmailAddress, assertSafeHeaderValue, MailHeaderValidationError } from "@/lib/mail-header-safety";

describe("assertSafeHeaderValue", () => {
  it("accepts an ordinary value", () => {
    expect(() => assertSafeHeaderValue("subject", "Your receipt is ready")).not.toThrow();
  });

  it("accepts Unicode text", () => {
    expect(() => assertSafeHeaderValue("subject", "Réunion — 会议记录 📋")).not.toThrow();
  });

  it("accepts an internal tab character", () => {
    expect(() => assertSafeHeaderValue("subject", "Column1\tColumn2")).not.toThrow();
  });

  it("rejects a bare CR", () => {
    expect(() => assertSafeHeaderValue("subject", "Hi\rBcc: attacker@evil.example")).toThrow(MailHeaderValidationError);
  });

  it("rejects a bare LF", () => {
    expect(() => assertSafeHeaderValue("subject", "Hi\nBcc: attacker@evil.example")).toThrow(MailHeaderValidationError);
  });

  it("rejects a full CRLF sequence", () => {
    expect(() => assertSafeHeaderValue("subject", "Hi\r\nBcc: attacker@evil.example")).toThrow(MailHeaderValidationError);
  });

  it("rejects a NUL byte", () => {
    expect(() => assertSafeHeaderValue("subject", "Hi\x00there")).toThrow(MailHeaderValidationError);
  });

  it("rejects other C0 control characters", () => {
    expect(() => assertSafeHeaderValue("subject", "Hi\x1Bthere")).toThrow(MailHeaderValidationError);
  });

  it("error message identifies the field but never echoes the value", () => {
    try {
      assertSafeHeaderValue("subject", "Hi\r\nBcc: attacker@evil.example");
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MailHeaderValidationError);
      expect((error as Error).message).toContain("subject");
      expect((error as Error).message).not.toContain("attacker@evil.example");
    }
  });
});

describe("assertSafeEmailAddress", () => {
  it("accepts a normal, valid address", () => {
    expect(() => assertSafeEmailAddress("to", "member@example.org")).not.toThrow();
  });

  it("rejects an address with a CRLF injection payload", () => {
    expect(() => assertSafeEmailAddress("to", "member@example.org\r\nBcc: attacker@evil.example")).toThrow(MailHeaderValidationError);
  });

  it("rejects a syntactically invalid address with no control characters", () => {
    expect(() => assertSafeEmailAddress("to", "not-an-email")).toThrow(MailHeaderValidationError);
  });

  it("rejects an empty string", () => {
    expect(() => assertSafeEmailAddress("to", "")).toThrow(MailHeaderValidationError);
  });
});
