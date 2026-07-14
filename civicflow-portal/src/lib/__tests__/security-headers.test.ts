import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { applySecurityHeaders } from "@/lib/security-headers";

describe("applySecurityHeaders", () => {
  it("sets HSTS without the preload directive", () => {
    const res = applySecurityHeaders(NextResponse.next());
    const hsts = res.headers.get("Strict-Transport-Security");
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).not.toContain("preload");
  });

  it("sets clickjacking and MIME-sniffing protections", () => {
    const res = applySecurityHeaders(NextResponse.next());
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("disables camera/microphone/geolocation by default", () => {
    const res = applySecurityHeaders(NextResponse.next());
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("sets a CSP that allows self, DO Spaces images, and data: URIs (QR codes)", () => {
    const res = applySecurityHeaders(NextResponse.next());
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("img-src 'self' data: blob: https://*.digitaloceanspaces.com");
  });

  it("applies to a plain Response (e.g. a rate-limit block) as well as NextResponse", () => {
    const res = applySecurityHeaders(new Response("too many requests", { status: 429 }));
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=31536000");
    expect(res.status).toBe(429);
  });
});
