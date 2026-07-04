import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.string().url(),
  // Optional at the env-validation level (unlike NEXTAUTH_SECRET) so a
  // missing value doesn't break unrelated requests app-wide — mobile-auth.ts
  // throws its own clear error if a mobile auth route is actually hit
  // without this configured.
  MOBILE_JWT_SECRET: z.string().min(1).optional(),
  // Base URL for universal links / web fallback pages (app.civicflowapp.com in
  // production; falls back to the portal's own URL until that domain is wired up).
  MOBILE_APP_WEB_BASE_URL: z.string().url().optional(),
  // Hostname (no protocol) that middleware rewrites /dues, /events, etc. to
  // their /m/* member web-fallback implementation — e.g. "app.civicflowapp.com".
  MOBILE_APP_WEB_HOST: z.string().optional(),
  // Universal link (iOS) / app link (Android) verification. Placeholders
  // until the app is enrolled in the Apple Developer Program / signed for
  // release — see mobile deployment docs.
  APPLE_APP_ID: z.string().optional(),
  ANDROID_PACKAGE_NAME: z.string().optional(),
  ANDROID_SHA256_CERT_FINGERPRINTS: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ESSENTIAL_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ELITE_MONTHLY: z.string().optional(),

  DO_SPACES_ENDPOINT: z.string().url(),
  DO_SPACES_REGION: z.string().min(1),
  DO_SPACES_BUCKET: z.string().min(1),
  DO_SPACES_ACCESS_KEY_ID: z.string().min(1),
  DO_SPACES_SECRET_ACCESS_KEY: z.string().min(1),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.string().regex(/^\d+$/),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  FROM_EMAIL: z.string().min(1),

  // Optional flags
  CIVICFLOW_USE_MEMORY_RATE_LIMITER: z.string().optional(),
  RATE_LIMIT_REDIS_URL: z.string().url().optional(),
  RATE_LIMIT_REDIS_TOKEN: z.string().optional(),
  ENABLE_EMAIL_SEND: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

const relaxedEnvSchema = serverEnvSchema.partial().extend({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Strict server env validation.
 * - In production: throws if required env vars are missing.
 * - In development/test: allows partial env for local coding and build safety.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const raw = {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    MOBILE_JWT_SECRET: process.env.MOBILE_JWT_SECRET,
    MOBILE_APP_WEB_BASE_URL: process.env.MOBILE_APP_WEB_BASE_URL,
    MOBILE_APP_WEB_HOST: process.env.MOBILE_APP_WEB_HOST,
    APPLE_APP_ID: process.env.APPLE_APP_ID,
    ANDROID_PACKAGE_NAME: process.env.ANDROID_PACKAGE_NAME,
    ANDROID_SHA256_CERT_FINGERPRINTS: process.env.ANDROID_SHA256_CERT_FINGERPRINTS,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ESSENTIAL_MONTHLY: process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
    STRIPE_PRICE_ELITE_MONTHLY: process.env.STRIPE_PRICE_ELITE_MONTHLY,
    DO_SPACES_ENDPOINT: process.env.DO_SPACES_ENDPOINT,
    DO_SPACES_REGION: process.env.DO_SPACES_REGION,
    DO_SPACES_BUCKET: process.env.DO_SPACES_BUCKET,
    DO_SPACES_ACCESS_KEY_ID: process.env.DO_SPACES_ACCESS_KEY_ID,
    DO_SPACES_SECRET_ACCESS_KEY: process.env.DO_SPACES_SECRET_ACCESS_KEY,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    FROM_EMAIL: process.env.FROM_EMAIL,
    CIVICFLOW_USE_MEMORY_RATE_LIMITER: process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER,
    RATE_LIMIT_REDIS_URL: process.env.RATE_LIMIT_REDIS_URL,
    RATE_LIMIT_REDIS_TOKEN: process.env.RATE_LIMIT_REDIS_TOKEN,
    ENABLE_EMAIL_SEND: process.env.ENABLE_EMAIL_SEND,
  };

  if (raw.NODE_ENV === "production") {
    const parsed = serverEnvSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid server environment: ${issues}`);
    }
    cached = parsed.data;
    return cached;
  }

  const parsed = relaxedEnvSchema.parse(raw);
  cached = {
    NODE_ENV: parsed.NODE_ENV,
    DATABASE_URL: parsed.DATABASE_URL ?? "",
    NEXTAUTH_SECRET: parsed.NEXTAUTH_SECRET ?? "",
    NEXTAUTH_URL: parsed.NEXTAUTH_URL ?? "http://localhost:3000",
    MOBILE_JWT_SECRET: parsed.MOBILE_JWT_SECRET ?? "dev-insecure-mobile-jwt-secret",
    MOBILE_APP_WEB_BASE_URL: parsed.MOBILE_APP_WEB_BASE_URL,
    MOBILE_APP_WEB_HOST: parsed.MOBILE_APP_WEB_HOST,
    APPLE_APP_ID: parsed.APPLE_APP_ID,
    ANDROID_PACKAGE_NAME: parsed.ANDROID_PACKAGE_NAME,
    ANDROID_SHA256_CERT_FINGERPRINTS: parsed.ANDROID_SHA256_CERT_FINGERPRINTS,
    STRIPE_SECRET_KEY: parsed.STRIPE_SECRET_KEY ?? "",
    STRIPE_WEBHOOK_SECRET: parsed.STRIPE_WEBHOOK_SECRET ?? "",
    STRIPE_PRICE_ESSENTIAL_MONTHLY: parsed.STRIPE_PRICE_ESSENTIAL_MONTHLY,
    STRIPE_PRICE_ELITE_MONTHLY: parsed.STRIPE_PRICE_ELITE_MONTHLY,
    DO_SPACES_ENDPOINT: parsed.DO_SPACES_ENDPOINT ?? "https://nyc3.digitaloceanspaces.com",
    DO_SPACES_REGION: parsed.DO_SPACES_REGION ?? "nyc3",
    DO_SPACES_BUCKET: parsed.DO_SPACES_BUCKET ?? "dev-bucket",
    DO_SPACES_ACCESS_KEY_ID: parsed.DO_SPACES_ACCESS_KEY_ID ?? "",
    DO_SPACES_SECRET_ACCESS_KEY: parsed.DO_SPACES_SECRET_ACCESS_KEY ?? "",
    SMTP_HOST: parsed.SMTP_HOST ?? "",
    SMTP_PORT: parsed.SMTP_PORT ?? "587",
    SMTP_USER: parsed.SMTP_USER ?? "",
    SMTP_PASS: parsed.SMTP_PASS ?? "",
    FROM_EMAIL: parsed.FROM_EMAIL ?? "CivicFlow <noreply@example.com>",
    CIVICFLOW_USE_MEMORY_RATE_LIMITER: parsed.CIVICFLOW_USE_MEMORY_RATE_LIMITER,
    RATE_LIMIT_REDIS_URL: parsed.RATE_LIMIT_REDIS_URL,
    RATE_LIMIT_REDIS_TOKEN: parsed.RATE_LIMIT_REDIS_TOKEN,
    ENABLE_EMAIL_SEND: parsed.ENABLE_EMAIL_SEND,
    CRON_SECRET: parsed.CRON_SECRET,
  };

  return cached;
}

export function isEmailSendEnabled() {
  const env = getServerEnv();
  return env.ENABLE_EMAIL_SEND === "1" || env.ENABLE_EMAIL_SEND === "true";
}

/** Base URL for member-facing universal links / web fallback pages. */
export function getMobileAppWebBaseUrl(): string {
  const env = getServerEnv();
  return (env.MOBILE_APP_WEB_BASE_URL ?? env.NEXTAUTH_URL).replace(/\/+$/, "");
}
