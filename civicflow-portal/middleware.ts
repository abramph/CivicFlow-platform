import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const pathname = req.nextUrl.pathname;
  const isLoginRoute = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/auth");

  if (!token && !isLoginRoute && !isAuthApi) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (token && isLoginRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
