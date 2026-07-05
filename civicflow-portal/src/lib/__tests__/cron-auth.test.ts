import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCronSecret } from "@/lib/cron-auth";

describe("validateCronSecret", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
  });

  afterEach(() => {
    process.env.CRON_SECRET = original;
  });

  function requestWithAuth(header: string | null) {
    const headers = new Headers();
    if (header !== null) headers.set("authorization", header);
    return new Request("https://portal.test/api/cron/reminders", { headers });
  }

  it("accepts the correct bearer secret", () => {
    expect(validateCronSecret(requestWithAuth("Bearer test-cron-secret"))).toBe(true);
  });

  it("rejects a missing authorization header", () => {
    expect(validateCronSecret(requestWithAuth(null))).toBe(false);
  });

  it("rejects an incorrect secret", () => {
    expect(validateCronSecret(requestWithAuth("Bearer wrong-secret"))).toBe(false);
  });

  it("rejects a secret of a different length without throwing", () => {
    expect(validateCronSecret(requestWithAuth("Bearer short"))).toBe(false);
  });

  it("fails closed when CRON_SECRET itself is not configured", () => {
    delete process.env.CRON_SECRET;
    expect(validateCronSecret(requestWithAuth("Bearer test-cron-secret"))).toBe(false);
  });
});
