/**
 * Safety guard shared by every fictional-demo seed script
 * (seed-pta-demo.ts, seed-hoa-demo.ts, seed-union-demo.ts).
 *
 * Two real problems this closes:
 *
 * 1. `loadEnvConfig(process.cwd())` called with no second argument resolves
 *    `.env.production.local > .env.local > .env.production > .env`
 *    (@next/env's own `dev` param defaults to falsy -> "production" env-file
 *    precedence) -- which is exactly what `.env`/`.env.local` point at in
 *    this repo. A demo-seed script run as a bare `npx tsx prisma/seed-*.ts`,
 *    with no NODE_ENV set, would silently connect to PRODUCTION rather than
 *    a local/disposable database, despite every seed script's own doc
 *    comment claiming "never point this at production." `loadDemoEnv()`
 *    fixes this at the source by always passing `dev: true`, matching
 *    prisma.config.ts's own established fix for the identical class of bug.
 *
 * 2. Defense in depth: even with (1) fixed, a misconfigured shell (e.g.
 *    NODE_ENV=production explicitly exported) could still resolve
 *    DATABASE_URL to production. `assertNotProduction()` refuses to
 *    proceed if the resolved DATABASE_URL's host matches the known
 *    production cluster, regardless of how it got resolved.
 */
import { loadEnvConfig } from "@next/env";

const PRODUCTION_HOST_MARKER = "civicflowprod";

export function loadDemoEnv(): void {
  loadEnvConfig(process.cwd(), true);
}

export function assertNotProduction(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (url.includes(PRODUCTION_HOST_MARKER)) {
    throw new Error(
      "Refusing to run a fictional-demo seed script against what looks like the production database " +
        `(DATABASE_URL host contains "${PRODUCTION_HOST_MARKER}"). This script is only safe to run ` +
        "against a local or disposable database. Check .env.development.local and your shell's NODE_ENV."
    );
  }
}
