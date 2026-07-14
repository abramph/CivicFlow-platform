import { describe, expect, it } from "vitest";
import { computeLegacyRedirectTarget, parseLegacyHosts } from "@/lib/legacy-redirect";

const LEGACY = ["app.civicflowapp.com"];
const CANONICAL = "https://app.getunestra.com";

function target(url: string, opts?: { legacyHosts?: string[]; canonicalBase?: string }) {
  return computeLegacyRedirectTarget({
    url,
    legacyHosts: opts?.legacyHosts ?? LEGACY,
    canonicalBase: opts?.canonicalBase ?? CANONICAL,
  });
}

describe("parseLegacyHosts", () => {
  it("splits, trims, lowercases, and drops blanks", () => {
    expect(parseLegacyHosts(" App.CivicflowApp.com , , foo.com ")).toEqual([
      "app.civicflowapp.com",
      "foo.com",
    ]);
  });
  it("returns an empty list when unset", () => {
    expect(parseLegacyHosts(undefined)).toEqual([]);
    expect(parseLegacyHosts("")).toEqual([]);
  });
});

describe("computeLegacyRedirectTarget", () => {
  it("redirects the root path to the canonical host", () => {
    expect(target("https://app.civicflowapp.com/")).toBe("https://app.getunestra.com/");
  });

  it("redirects a nested path to the canonical host", () => {
    expect(target("https://app.civicflowapp.com/login")).toBe("https://app.getunestra.com/login");
  });

  it("preserves the query string (e.g. callbackUrl)", () => {
    expect(target("https://app.civicflowapp.com/login?callbackUrl=%2Fdashboard")).toBe(
      "https://app.getunestra.com/login?callbackUrl=%2Fdashboard"
    );
  });

  it("does not redirect when already on the canonical host", () => {
    expect(target("https://app.getunestra.com/login")).toBeNull();
  });

  it("does not create a loop if the canonical host is mistakenly in the legacy list", () => {
    expect(
      target("https://app.getunestra.com/login", { legacyHosts: ["app.getunestra.com"] })
    ).toBeNull();
  });

  it("is a no-op when the feature is disabled (no legacy hosts)", () => {
    expect(target("https://app.civicflowapp.com/login", { legacyHosts: [] })).toBeNull();
  });

  it("is a no-op when no canonical base is configured", () => {
    expect(
      computeLegacyRedirectTarget({
        url: "https://app.civicflowapp.com/login",
        legacyHosts: LEGACY,
        canonicalBase: undefined,
      })
    ).toBeNull();
  });

  it("exempts webhook endpoints external services still call", () => {
    expect(target("https://app.civicflowapp.com/api/webhooks/stripe")).toBeNull();
    expect(target("https://app.civicflowapp.com/api/webhooks/twilio/inbound")).toBeNull();
  });

  it("exempts cron, mobile API, and well-known universal-link files", () => {
    expect(target("https://app.civicflowapp.com/api/cron/reminders")).toBeNull();
    expect(target("https://app.civicflowapp.com/api/mobile/auth/login")).toBeNull();
    expect(target("https://app.civicflowapp.com/.well-known/apple-app-site-association")).toBeNull();
  });

  it("still redirects non-exempt API routes", () => {
    expect(target("https://app.civicflowapp.com/api/health")).toBe(
      "https://app.getunestra.com/api/health"
    );
  });

  it("does not touch unrelated hosts", () => {
    expect(target("https://app.getunestra.com/")).toBeNull();
    expect(target("https://evil.example.com/login")).toBeNull();
  });
});
