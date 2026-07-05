import { describe, expect, it } from "vitest";
import { generateOtpCode, hashOtpCode, isValidE164Phone, maskPhone, otpExpiresAt } from "@/lib/sms-otp";

describe("generateOtpCode", () => {
  it("always produces a zero-padded 6-digit numeric string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("hashOtpCode", () => {
  it("is deterministic for the same input", () => {
    expect(hashOtpCode("123456")).toBe(hashOtpCode("123456"));
  });

  it("produces different hashes for different codes", () => {
    expect(hashOtpCode("123456")).not.toBe(hashOtpCode("654321"));
  });
});

describe("otpExpiresAt", () => {
  it("returns a time in the future", () => {
    expect(otpExpiresAt().getTime()).toBeGreaterThan(Date.now());
  });
});

describe("maskPhone", () => {
  it("keeps only the last 4 digits visible", () => {
    expect(maskPhone("+15551234567")).toBe("•••••••4567");
  });

  it("masks fully when there aren't more than 4 digits", () => {
    expect(maskPhone("123")).toBe("•••");
  });
});

describe("isValidE164Phone", () => {
  it("accepts a well-formed E.164 number", () => {
    expect(isValidE164Phone("+15551234567")).toBe(true);
  });

  it("rejects numbers missing the leading +", () => {
    expect(isValidE164Phone("15551234567")).toBe(false);
  });

  it("rejects obviously malformed input", () => {
    expect(isValidE164Phone("not-a-phone")).toBe(false);
    expect(isValidE164Phone("+0123")).toBe(false);
  });
});
