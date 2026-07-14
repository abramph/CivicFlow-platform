/**
 * Baseline security headers for every response. Pulled into a pure function
 * (rather than inlined in middleware) so it's unit-testable without a full
 * NextRequest/NextResponse round trip.
 *
 * CSP is scoped to what the app actually loads: no inline/third-party
 * scripts, no client-side Stripe.js (checkout is a server-issued redirect
 * URL), self-hosted fonts via next/font, and image sources limited to the
 * app itself plus DO Spaces (signed receipt/photo URLs) and data: (QR code
 * images are rendered as data URLs). Tighten further (e.g. add a Sentry
 * ingest host to connect-src) if NEXT_PUBLIC_SENTRY_DSN is ever configured.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.digitaloceanspaces.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Accepts either a NextResponse or a plain Response (e.g. what
// requireRateLimit() returns) — both expose a mutable Headers object, so the
// same header-setting logic works for either.
export function applySecurityHeaders<T extends Response>(response: T): T {
  // includeSubDomains is scoped to the domain that serves this header (e.g.
  // app.getunestra.com and its own subdomains) — it does not affect sibling
  // domains like getunestra.com or civicflowapp.com. `preload` is
  // intentionally omitted: HSTS preload-list submission is effectively
  // irreversible and should be an explicit, informed opt-in, not something
  // silently baked into a domain-migration deploy.
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", CSP);
  return response;
}
