import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { requireRateLimit } from "@/lib/rate-limit";

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

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

  // Stripe webhooks and cron endpoints use their own secret — not NextAuth sessions
  if (pathname === "/api/webhooks/stripe" || pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const isPublicPage =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/verify-email" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/pricing";
  const isAuthApi = pathname.startsWith("/api/auth");
  const isPublicApi = pathname === "/api/health";

  if (!token && !isPublicPage && !isAuthApi && !isPublicApi) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (token && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
