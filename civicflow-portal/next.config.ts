import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "192.168.1.176",
    "http://192.168.1.176:3000",
    "http://localhost:3000",
  ],
  turbopack: {
    root: process.cwd(),
  },
  // Defense in depth for paths middleware's matcher excludes (_next/static,
  // _next/image, favicon.ico) — every other path already gets these via
  // applySecurityHeaders() in middleware.ts, which is the source of truth.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  automaticVercelMonitors: false,
  // Source map uploads require SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT.
  // Those aren't configured on this app, so uploads never happen — but
  // generation still ran on every build regardless, and at 337+ API routes
  // that pushed `next build`'s heap past the DO builder's ceiling (OOM).
  // Disabled outright since we get zero benefit from maps nothing uploads.
  sourcemaps: { disable: true },
});
