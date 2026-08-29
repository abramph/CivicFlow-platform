import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { withSentryConfig } from "@sentry/nextjs";

const baseConfig: NextConfig = {
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

/**
 * fix/portal-production-tsconfig-memory: `next build`'s internal TypeScript
 * check was OOM-crashing DigitalOcean's build container (see
 * docs/portal-build-typecheck-separation.md) because tsconfig.json's
 * `include` is repo-wide — production source and the full ~391-file test
 * suite are checked as one program. tsconfig.build.json narrows that to
 * production-only entries, with identical (unweakened) compilerOptions.
 *
 * This must apply ONLY during `next build`, never `next dev` — Next reads
 * `typescript.tsconfigPath` in both the production build (build/type-check)
 * AND the dev server's webpack hot-reloader, so an unconditional value would
 * silently stop `next dev` from surfacing type errors in test files too.
 * The function-config-export form is Next's own documented mechanism for
 * exactly this: `normalizeConfig` calls `config(phase, { defaultConfig })`
 * whenever the exported config is a function (confirmed directly in
 * next/dist/server/config-shared.js). withSentryConfig explicitly supports
 * wrapping a function-form config the same way (confirmed in
 * @sentry/nextjs's withSentryConfig.js) — it forwards the same (phase, ...)
 * arguments to this function and merges Sentry's own settings into whatever
 * this returns, so both mechanisms compose correctly.
 */
function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    return {
      ...baseConfig,
      typescript: {
        tsconfigPath: "tsconfig.build.json",
      },
    };
  }
  return baseConfig;
}

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
