import { describe, expect, it } from "vitest";
import { validateDeepLink } from "@/lib/deep-links";

describe("validateDeepLink", () => {
  it("accepts known bare paths", () => {
    expect(validateDeepLink("/report-payment")).toBe("/report-payment");
    expect(validateDeepLink("/dues")).toBe("/dues");
    expect(validateDeepLink("/announcements")).toBe("/announcements");
    expect(validateDeepLink("/events")).toBe("/events");
    expect(validateDeepLink("/payment-history")).toBe("/payment-history");
  });

  it("accepts the custom scheme form", () => {
    expect(validateDeepLink("civicflow://report-payment")).toBe("civicflow://report-payment");
  });

  it("accepts the universal link form", () => {
    expect(validateDeepLink("https://app.civicflowapp.com/dues")).toBe("https://app.civicflowapp.com/dues");
  });

  it("accepts an organization switch link with a valid-looking id", () => {
    expect(validateDeepLink("civicflow://organization/abc123")).toBe("civicflow://organization/abc123");
  });

  it("rejects unknown destinations", () => {
    expect(validateDeepLink("/settings/users")).toBeNull();
    expect(validateDeepLink("civicflow://settings/users")).toBeNull();
    expect(validateDeepLink("https://evil.example.com/dues")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(validateDeepLink("not a url at all")).toBeNull();
    expect(validateDeepLink(null)).toBeNull();
    expect(validateDeepLink(undefined)).toBeNull();
    expect(validateDeepLink("")).toBeNull();
  });

  it("rejects an organization link with extra path segments", () => {
    expect(validateDeepLink("civicflow://organization/abc/extra")).toBeNull();
  });
});
