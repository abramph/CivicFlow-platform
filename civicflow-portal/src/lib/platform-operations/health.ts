import "server-only";
import { prisma } from "@/lib/prisma";
import type { ServiceHealth, ServiceStatus } from "./types";
import { getJobsHealthSummary } from "./jobs";

const DEFAULT_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Raw driver/SDK error messages (Prisma, Stripe, etc.) can contain internal
 * infrastructure details — a Postgres connection failure's message includes
 * the literal database hostname, for example. Never render that on a page,
 * even one gated to platform admins: log the real error server-side (visible
 * in DO's own app logs to anyone who already has that access) and return
 * only a coarse, safe category to the UI.
 */
function safeHealthMessage(service: string, error: unknown, timedOut: boolean): string {
  console.error(`[platform-operations/health] ${service} check failed:`, error);
  if (timedOut) return "Timed out";
  return "Check failed — see server logs for detail";
}

async function checkDatabase(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DEFAULT_TIMEOUT_MS);
    return {
      service: "Production database",
      status: "healthy",
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
      message: "Query round-trip succeeded",
      freshness: "live",
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.message.startsWith("Timed out after");
    return {
      service: "Production database",
      status: "unavailable",
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
      message: safeHealthMessage("Production database", error, timedOut),
      freshness: "live",
    };
  }
}

function checkWebPortal(): ServiceHealth {
  // This page rendering at all *is* the live signal — no separate
  // self-fetch of /api/health is made to avoid an unnecessary server-to-
  // itself network round trip on every Operations Center page load.
  return {
    service: "Web portal",
    status: "healthy",
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message: "This page is being served by the web portal, so it is up.",
    freshness: "live",
  };
}

function checkAuthentication(dbHealthy: boolean): ServiceHealth {
  const configured = Boolean(process.env.NEXTAUTH_SECRET);
  return {
    service: "Authentication",
    status: !configured ? "not_configured" : dbHealthy ? "healthy" : "degraded",
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message: !configured
      ? "NEXTAUTH_SECRET is not set"
      : dbHealthy
        ? "Session config present and the session store (database) is reachable"
        : "Session config present, but the session store (database) failed its check",
    freshness: "inferred",
  };
}

async function checkStripe(): Promise<ServiceHealth> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      service: "Stripe",
      status: "not_configured",
      checkedAt: new Date().toISOString(),
      responseTimeMs: null,
      message: "STRIPE_SECRET_KEY is not set",
      freshness: "unavailable",
    };
  }

  const start = Date.now();
  try {
    const { getStripe } = await import("@/lib/stripe");
    await withTimeout(getStripe().balance.retrieve(), DEFAULT_TIMEOUT_MS);
    return {
      service: "Stripe",
      status: "healthy",
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
      message: "Balance API call succeeded",
      freshness: "live",
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.message.startsWith("Timed out after");
    return {
      service: "Stripe",
      status: "degraded",
      checkedAt: new Date().toISOString(),
      responseTimeMs: Date.now() - start,
      message: safeHealthMessage("Stripe", error, timedOut),
      freshness: "live",
    };
  }
}

async function checkTwilio(): Promise<ServiceHealth> {
  const { getEffectiveTwilioCredentials } = await import("@/lib/sms-credentials");
  const credentials = await getEffectiveTwilioCredentials();
  return {
    service: "Twilio",
    status: credentials ? "healthy" : "not_configured",
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message: credentials
      ? `Credentials configured (source: ${credentials.source}); no live API call made`
      : "No Twilio credentials configured (database or environment)",
    freshness: "inferred",
  };
}

function checkBrevo(): ServiceHealth {
  const configured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return {
    service: "Brevo (email)",
    status: configured ? "healthy" : "not_configured",
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message: configured ? "SMTP credentials configured; no live connection test made" : "SMTP_HOST/SMTP_USER/SMTP_PASS not fully set",
    freshness: "inferred",
  };
}

function checkExpoPush(): ServiceHealth {
  return {
    service: "Expo push",
    status: "unknown",
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message: "Expo push requires no platform credentials in this app; no live health signal exists. Delivery volume is visible on the Communications page.",
    freshness: "unavailable",
  };
}

function checkLicenseServer(): ServiceHealth {
  const url = process.env.CIVICFLOW_LICENSE_SERVER_URL;
  return {
    service: "License server (desktop store checkout)",
    status: url ? "healthy" : "not_configured",
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message: url ? "CIVICFLOW_LICENSE_SERVER_URL is set; no live call made (no confirmed health endpoint contract)" : "CIVICFLOW_LICENSE_SERVER_URL is not set",
    freshness: "inferred",
  };
}

function checkObjectStorage(): ServiceHealth {
  const configured = Boolean(
    process.env.DO_SPACES_ENDPOINT && process.env.DO_SPACES_BUCKET && process.env.DO_SPACES_ACCESS_KEY_ID
  );
  return {
    service: "Object storage (DigitalOcean Spaces)",
    status: configured ? "healthy" : "not_configured",
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message: configured ? "Spaces credentials configured; no live connection test made" : "DO_SPACES_* env vars not fully set",
    freshness: "inferred",
  };
}

async function checkScheduledJobs(): Promise<ServiceHealth> {
  const summary = await getJobsHealthSummary();
  let status: ServiceStatus = "unknown";
  if (summary.status === "not_configured") status = "not_configured";
  else if (summary.status === "ok") status = summary.value.recentFailureCount > 0 ? "degraded" : "healthy";

  return {
    service: "Scheduled jobs",
    status,
    checkedAt: new Date().toISOString(),
    responseTimeMs: null,
    message:
      summary.status === "ok"
        ? `${summary.value.recentFailureCount} failure(s) recorded in the last 7 days (derived from platform audit events)`
        : summary.status === "not_configured"
          ? summary.reason
          : summary.reason,
    freshness: summary.status === "ok" ? "cached" : "unavailable",
  };
}

export async function getSystemHealth(): Promise<ServiceHealth[]> {
  const database = await checkDatabase();
  const [authentication, stripe, twilio, brevo, expo, licenseServer, objectStorage, scheduledJobs] = await Promise.all([
    Promise.resolve(checkAuthentication(database.status === "healthy")),
    checkStripe(),
    checkTwilio(),
    Promise.resolve(checkBrevo()),
    Promise.resolve(checkExpoPush()),
    Promise.resolve(checkLicenseServer()),
    Promise.resolve(checkObjectStorage()),
    checkScheduledJobs(),
  ]);

  return [checkWebPortal(), database, authentication, stripe, twilio, brevo, expo, licenseServer, objectStorage, scheduledJobs];
}
