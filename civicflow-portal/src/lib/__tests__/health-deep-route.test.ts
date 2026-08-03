import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requireSuperAdmin: (...a: unknown[]) => requireSuperAdmin(...a) };
});

const queryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) },
}));

const getServerEnv = vi.fn();
vi.mock("@/lib/env", () => ({
  getServerEnv: (...a: unknown[]) => getServerEnv(...a),
}));

import { GET } from "@/app/api/health/deep/route";
import { ForbiddenError } from "@/lib/auth-guards";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  requireSuperAdmin.mockResolvedValue({ session: { userId: "admin-1", userEmail: "admin@example.com" } });
  queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  getServerEnv.mockReturnValue({});
});

describe("GET /api/health/deep", () => {
  it("requires platform-admin auth before running any checks", async () => {
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Platform role denied: SUPER_ADMIN"));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reports ok:true with all checks passing when every dependency is configured and reachable", async () => {
    process.env.ENABLE_EMAIL_SEND = "1";
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.DO_SPACES_ENDPOINT = "https://x.digitaloceanspaces.com";
    process.env.DO_SPACES_BUCKET = "bucket";
    process.env.DO_SPACES_ACCESS_KEY_ID = "key";
    process.env.DO_SPACES_SECRET_ACCESS_KEY = "secret";
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://x@sentry.io/1";

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.email.ok).toBe(true);
    expect(body.checks.stripe.ok).toBe(true);
    expect(body.checks.objectStorage.ok).toBe(true);
    expect(body.checks.errorMonitoring.ok).toBe(true);
  });

  it("reports ok:false with 503 and a sanitized reason when the database is unreachable, without leaking connection details", async () => {
    queryRaw.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:5432 user=doadmin password=hunter2"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.database).toEqual({ ok: false, error: "unreachable" });
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
  });

  it("reports environment misconfiguration without leaking which specific variables or their values", async () => {
    getServerEnv.mockImplementation(() => {
      throw new Error("Invalid server environment: DATABASE_URL=postgres://user:secret@host/db is malformed");
    });

    const response = await GET();
    const body = await response.json();

    expect(body.checks.environment).toEqual({ ok: false, error: "invalid or missing required configuration" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("reports individual integrations as not-ok when their env vars are absent, without failing the whole request", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    const response = await GET();
    const body = await response.json();

    expect(body.checks.stripe.ok).toBe(false);
    expect(body.checks.errorMonitoring.ok).toBe(false);
    expect(response.status).toBe(503); // overall still reflects the gap
  });
});
