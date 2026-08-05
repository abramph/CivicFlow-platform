import { describe, expect, it } from "vitest";
import { buildPayLink, getPaymentMethodCategory, getPayLinkHostname } from "@/lib/payment-method-links";

describe("getPaymentMethodCategory", () => {
  it("categorizes STRIPE as native", () => {
    expect(getPaymentMethodCategory("STRIPE")).toBe("native");
  });

  it("categorizes PAYPAL, VENMO, and CASH_APP as external", () => {
    expect(getPaymentMethodCategory("PAYPAL")).toBe("external");
    expect(getPaymentMethodCategory("VENMO")).toBe("external");
    expect(getPaymentMethodCategory("CASH_APP")).toBe("external");
  });

  it("categorizes everything else as offline", () => {
    expect(getPaymentMethodCategory("CASH")).toBe("offline");
    expect(getPaymentMethodCategory("CHECK")).toBe("offline");
    expect(getPaymentMethodCategory("ZELLE")).toBe("offline");
    expect(getPaymentMethodCategory("ACH")).toBe("offline");
    expect(getPaymentMethodCategory("OTHER")).toBe("offline");
  });
});

describe("buildPayLink", () => {
  it("builds a cash.app link from a bare cashtag", () => {
    expect(buildPayLink("CASH_APP", "$jane")).toBe("https://cash.app/$jane");
    expect(buildPayLink("CASH_APP", "jane")).toBe("https://cash.app/$jane");
  });

  it("builds a venmo link from a bare username", () => {
    expect(buildPayLink("VENMO", "@jane")).toBe("https://venmo.com/u/jane");
  });

  it("builds a paypal.me link from a bare handle", () => {
    expect(buildPayLink("PAYPAL", "jane")).toBe("https://paypal.me/jane");
  });

  it("passes through an already-https URL unchanged", () => {
    expect(buildPayLink("PAYPAL", "https://paypal.me/jane")).toBe("https://paypal.me/jane");
  });

  it("rejects an http:// URL rather than silently accepting an insecure scheme", () => {
    expect(buildPayLink("PAYPAL", "http://paypal.me/jane")).toBeNull();
  });

  it("treats a non-URL string containing 'javascript:' as a literal handle, safely URL-encoded into a fixed https domain", () => {
    // Only strings starting with http(s):// are ever parsed as an absolute URL (and then
    // checked for the https: protocol) -- anything else is opaque text for the method's
    // fixed-domain path segment, so there's never a scheme to inject.
    const result = buildPayLink("PAYPAL", "javascript:alert(1)");
    expect(result).not.toBeNull();
    expect(result).toMatch(/^https:\/\/paypal\.me\//);
  });


  it("rejects an unparseable string masquerading as a URL", () => {
    expect(buildPayLink("PAYPAL", "https://")).toBeNull();
  });

  it("returns null for an empty account identifier", () => {
    expect(buildPayLink("CASH_APP", "   ")).toBeNull();
  });

  it("returns null for offline-category methods (no universal link concept)", () => {
    expect(buildPayLink("CHECK", "123 Main St")).toBeNull();
  });
});

describe("getPayLinkHostname", () => {
  it("extracts the hostname from a built pay link", () => {
    expect(getPayLinkHostname("https://paypal.me/jane")).toBe("paypal.me");
  });

  it("returns null for an unparseable URL", () => {
    expect(getPayLinkHostname("not-a-url")).toBeNull();
  });
});
