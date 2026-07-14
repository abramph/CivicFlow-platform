import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { requireRateLimit } from "@/lib/rate-limit";
import { computeLegacyRedirectTarget, parseLegacyHosts } from "@/lib/legacy-redirect";
import { applySecurityHeaders } from "@/lib/security-headers";

// Every response below depends on live session/auth state (including which
// pathname is even allowed), so none of it may ever be cached by the browser
// or an intermediary — a stale cached redirect/RSC response served back on
// browser back/forward navigation is exactly what makes the MFA challenge
// page (or any gated page) render as a raw, un-hydrated payload instead of
// the real page.
function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return response;
}

// Paths the member-facing universal link domain (app.civicflowapp.com, set
// via MOBILE_APP_WEB_HOST) transparently maps onto their /m/* implementation
// — kept separate from the staff portal's own /dues, /events, etc. pages.
const MEMBER_WEB_FALLBACK_PATHS = new Set([
  "/report-payment",
  "/dues",
  "/announcements",
  "/events",
  "/payment-history",
]);

// Single exit point for every request this middleware handles, so
// applySecurityHeaders() is guaranteed to run on every response (redirects,
// rewrites, rate-limit blocks, and pass-throughs alike) without having to
// remember to wrap each individual return below.
export async function middleware(req: NextRequest) {
  return applySecurityHeaders(await handle(req));
}

async function handle(req: NextRequest): Promise<Response> {
  // Domain migration: 308 any request that arrives on a legacy host to the
  // canonical host, preserving path + query. Runs first so it applies to every
  // route, and is a no-op until LEGACY_APP_HOSTS is set (see legacy-redirect.ts)
  // — safe to ship before app.getunestra.com is live.
  const legacyTarget = computeLegacyRedirectTarget({
    url: req.nextUrl.toString(),
    legacyHosts: parseLegacyHosts(process.env.LEGACY_APP_HOSTS),
    canonicalBase: process.env.CANONICAL_APP_URL || process.env.NEXTAUTH_URL,
  });
  if (legacyTarget) return withNoStore(NextResponse.redirect(legacyTarget, 308));

  const pathname = req.nextUrl.pathname;

  const memberWebHost = process.env.MOBILE_APP_WEB_HOST;
  if (memberWebHost && req.nextUrl.hostname === memberWebHost && MEMBER_WEB_FALLBACK_PATHS.has(pathname)) {
    return NextResponse.rewrite(new URL(`/m${pathname}`, req.url));
  }

  if (pathname === "/login") {
    const limited = await requireRateLimit({
      scope: "auth:login",
      request: req,
      limit: 40,
      windowMs: 60_000,
    });
    if (limited) return limited;
  }

  if (
    pathname === "/api/auth/signup" ||
    pathname === "/api/auth/forgot-password" ||
    pathname === "/api/auth/resend-verification"
  ) {
    const limited = await requireRateLimit({
      scope: "auth:sensitive",
      request: req,
      limit: 8,
      windowMs: 60_000,
    });
    if (limited) return limited;
  } else if (pathname.startsWith("/api/auth")) {
    const limited = await requireRateLimit({
      scope: "auth:api",
      request: req,
      limit: 60,
      windowMs: 60_000,
    });
    if (limited) return limited;
  }

  // Provider webhooks (Stripe, Twilio), cron endpoints, the mobile
  // bearer-token API, and the universal-link verification files all
  // authenticate (or intentionally don't) outside of the NextAuth cookie
  // session — never gate them here. Webhooks verify their own signature.
  if (
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/mobile/") ||
    pathname.startsWith("/.well-known/")
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Only ever preserved for this one allow-listed destination — a general
  // "redirect anywhere after login" mechanism would widen the open-redirect
  // surface across the whole app for a need that's specific to the QR
  // attendance check-in link.
  const isAttendanceCheckIn = pathname === "/attendance/check-in";

  // MFA pending: gate all non-auth routes behind the MFA challenge page
  if (token?.mfaPending) {
    const isMfaPage = pathname === "/login/mfa";
    const isAuthEndpoint = pathname.startsWith("/api/auth");
    if (!isMfaPage && !isAuthEndpoint) {
      const mfaUrl = new URL("/login/mfa", req.url);
      if (isAttendanceCheckIn) mfaUrl.searchParams.set("redirectTo", pathname + req.nextUrl.search);
      return withNoStore(NextResponse.redirect(mfaUrl));
    }
    const response = NextResponse.next();
    response.headers.set("x-pathname", pathname);
    return withNoStore(response);
  }

  const isPublicPage =
    pathname === "/login" ||
    pathname === "/login/mfa" ||
    pathname === "/signup" ||
    pathname === "/verify-email" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/pricing" ||
    pathname === "/accept-invite" ||
    pathname === "/sms-opt-in" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    // Member-facing web fallback pages for universal links — publicly
    // viewable so an anonymous visitor sees the "open in app" banner
    // instead of being bounced to the staff login page.
    pathname.startsWith("/m/");
  const isAuthApi = pathname.startsWith("/api/auth");
  // Anonymous desktop-license purchases from the marketing site create a
  // Checkout Session with no Unestra account involved — never gate it.
  const isPublicApi = pathname === "/api/health" || pathname === "/api/store/checkout";

  if (!token && !isPublicPage && !isAuthApi && !isPublicApi) {
    const loginUrl = new URL("/login", req.url);
    if (isAttendanceCheckIn) loginUrl.searchParams.set("redirectTo", pathname + req.nextUrl.search);
    return withNoStore(NextResponse.redirect(loginUrl));
  }

  if (token && !token.mfaPending && pathname === "/login") {
    return withNoStore(NextResponse.redirect(new URL("/select-organization", req.url)));
  }

  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);
  return withNoStore(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
