import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { requestHost } from "../../../middleware";

/**
 * Regression test for a real production bug (2026-07-14 domain-migration
 * cutover): behind DigitalOcean App Platform's edge, req.nextUrl.hostname
 * resolves to the container's internal address ("localhost"), not the
 * external domain the browser actually requested — silently breaking every
 * hostname comparison in middleware.ts (the legacy-redirect never matched,
 * and the not-yet-active MOBILE_APP_WEB_HOST rewrite would have had the same
 * bug). requestHost() must read the Host header instead.
 */
describe("requestHost", () => {
  it("reads the real external host from the Host header", () => {
    const req = new NextRequest("https://internal-placeholder.example/login", {
      headers: { host: "app.getunestra.com" },
    });
    expect(requestHost(req)).toBe("app.getunestra.com");
  });

  it("falls back to req.nextUrl.hostname when no Host header is present", () => {
    const req = new NextRequest("https://fallback.example/login");
    req.headers.delete("host");
    expect(requestHost(req)).toBe("fallback.example");
  });
});
