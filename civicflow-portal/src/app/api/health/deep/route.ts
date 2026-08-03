import { prisma } from "@/lib/prisma";
import { getServerEnv } from "@/lib/env";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireSuperAdmin } from "@/lib/auth-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deep health check — verifies actual dependency connectivity, unlike
 * /api/health (a pure liveness probe DigitalOcean's platform hits every 30s
 * with a 10s timeout to decide whether to restart the container — see
 * app spec `health_check`). Deliberately kept separate: if THIS endpoint
 * depended on the database and hit a transient blip, DO could misread a
 * slow query as "the app is down" and cycle a container that was actually
 * fine, turning a brief DB hiccup into real downtime. This endpoint is for
 * manual/monitoring use only, not wired into any auto-restart mechanism.
 *
 * Gated behind platform-admin auth (requireSuperAdmin) rather than left
 * public — even boolean "is X configured" flags are internal operational
 * detail that shouldn't be visible to an anonymous visitor. If this needs
 * to be polled by an external uptime monitor that can't authenticate as a
 * platform admin, add a shared-secret bypass then; don't loosen this by
 * default.
 *
 * Never returns connection strings, credentials, or stack traces — only a
 * per-dependency ok/error boolean and a short, sanitized reason string.
 */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireSuperAdmin("throw");
    return runChecks();
  });
}

async function runChecks(): Promise<Response> {
  const checks: Record<string, { ok: boolean; error?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch {
    checks.database = { ok: false, error: "unreachable" };
  }

  try {
    getServerEnv();
    checks.environment = { ok: true };
  } catch {
    checks.environment = { ok: false, error: "invalid or missing required configuration" };
  }

  checks.email = { ok: process.env.ENABLE_EMAIL_SEND === "1" || process.env.ENABLE_EMAIL_SEND === "true" };
  checks.stripe = { ok: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) };
  checks.objectStorage = {
    ok: Boolean(
      process.env.DO_SPACES_ENDPOINT &&
        process.env.DO_SPACES_BUCKET &&
        process.env.DO_SPACES_ACCESS_KEY_ID &&
        process.env.DO_SPACES_SECRET_ACCESS_KEY
    ),
  };
  checks.errorMonitoring = { ok: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) };

  const allOk = Object.values(checks).every((c) => c.ok);

  return Response.json({ ok: allOk, ts: Date.now(), checks }, { status: allOk ? 200 : 503 });
}
