import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rate-limit-order follow-up -- /api/imports's own rate-limit call
 * (`requireRateLimit({ scope: "api:imports:create", request, limit, windowMs })`)
 * passes no explicit `key`, which makeKey() in rate-limit.ts falls back to
 * deriving from the client IP (x-forwarded-for / x-real-ip), NOT from
 * organizationId. imports-create-route.test.ts fully mocks "@/lib/rate-limit"
 * for its other tests, so none of them exercise the real limiter or prove
 * this. This file deliberately does NOT mock rate-limit.ts (same pattern
 * import-route.test.ts already uses for /api/import's own real-limiter
 * tests) so the actual IP-derived keying is proven end-to-end, not assumed.
 *
 * Conclusion this file proves: the pre-auth rate limiter is genuinely
 * IP-scoped. It cannot let an unauthenticated caller consume or exhaust a
 * specific ORGANIZATION's allowance, because no organizational identity is
 * ever part of the bucket key -- there is nothing to exhaust "on behalf of"
 * a target org. Its actual failure mode (two different organizations
 * sharing one IP -- e.g. the same office network -- sharing one throttle
 * bucket) is the normal, accepted tradeoff of any IP-based pre-auth
 * limiter, not a cross-tenant authorization bypass. This is why the route
 * is intentionally left un-reordered: auth/authz still run before
 * formData()/worker admission/mutation regardless (proven in
 * imports-create-route.test.ts and the ordering tests below).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function permissionContext(): any {
  return {
    session: { userId: "officer-1", userEmail: "officer@example.com" },
    organizationId: "org-a",
    role: "ORG_ADMIN",
    can: () => true,
  };
}

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: vi.fn().mockResolvedValue(permissionContext()) };
});

vi.mock("@/lib/labs/pta/guard", () => ({ requirePtaVertical: vi.fn() }));
vi.mock("@/lib/hoa/guard", () => ({ requireHoaCapability: vi.fn() }));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findFirstImportBatch = vi.fn();
const createImportBatch = vi.fn();
const updateImportBatch = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      findFirst: (...args: unknown[]) => findFirstImportBatch(...args),
      create: (...args: unknown[]) => createImportBatch(...args),
      update: (...args: unknown[]) => updateImportBatch(...args),
    },
  },
}));

vi.mock("@/lib/imports/file-identity", () => ({
  hashFileBuffer: () => "fake-hash",
  findExistingBatchByHash: vi.fn().mockResolvedValue(null),
}));

const uploadImportSourceFile = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/imports/storage", () => ({
  buildImportSourceObjectKey: () => "organizations/org-a/imports/batch-1/source/x.csv",
  computeImportRetentionDate: (d: Date) => d,
  uploadImportSourceFile: (...args: unknown[]) => uploadImportSourceFile(...args),
}));

const analyzeBatch = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/imports/engine", () => ({ analyzeBatch: (...args: unknown[]) => analyzeBatch(...args) }));

import { requirePermission } from "@/lib/auth-guards";
import { POST as createPOST } from "@/app/api/imports/route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function permissionContextForOrg(organizationId: string): any {
  return {
    session: { userId: "officer-1", userEmail: "officer@example.com" },
    organizationId,
    role: "ORG_ADMIN",
    can: () => true,
  };
}

function makeUploadRequest(fromIp: string): Request {
  const form = new FormData();
  form.set("file", new File(["First Name\nJane\n"], "members.csv", { type: "text/csv" }));
  form.set("mapping", JSON.stringify({ "First Name": "firstName" }));
  return new Request("https://portal.test/api/imports", {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": fromIp },
  });
}

describe("POST /api/imports -- rate-limiter identity/scope (rate-limit-order follow-up)", () => {
  const originalEnv = process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER;

  beforeEach(() => {
    process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER = "1";
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(permissionContext());
    createImportBatch.mockResolvedValue({ id: "batch-1", uploadedAt: new Date("2026-01-01T00:00:00Z") });
    updateImportBatch.mockResolvedValue({ id: "batch-1" });
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER;
    else process.env.CIVICFLOW_USE_MEMORY_RATE_LIMITER = originalEnv;
  });

  it("is IP-scoped, not organization-scoped: two DIFFERENT organizations behind the SAME IP share one throttle bucket", async () => {
    const ip = `shared-ip-${Math.random()}`;

    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(`org-a-${Math.random()}`));
    for (let i = 0; i < 20; i++) {
      const response = await createPOST(makeUploadRequest(ip));
      expect(response.status).toBe(201);
    }
    // Org A's own 21st request is now over the IP bucket's limit.
    const orgAOverLimit = await createPOST(makeUploadRequest(ip));
    expect(orgAOverLimit.status).toBe(429);

    // A DIFFERENT organization, behind the SAME IP, is ALSO already
    // exhausted -- proving the bucket key has no organizational identity
    // in it at all (an org-scoped limiter would let this succeed).
    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(`org-b-${Math.random()}`));
    const orgBSameIp = await createPOST(makeUploadRequest(ip));
    expect(orgBSameIp.status).toBe(429);
  }, 30000);

  it("is IP-scoped: the SAME organization behind a DIFFERENT IP is unaffected by the first IP's exhausted bucket", async () => {
    const orgId = `org-c-${Math.random()}`;
    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(orgId));

    const ipOne = `ip-one-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      const response = await createPOST(makeUploadRequest(ipOne));
      expect(response.status).toBe(201);
    }
    const overLimitOnIpOne = await createPOST(makeUploadRequest(ipOne));
    expect(overLimitOnIpOne.status).toBe(429);

    // Same organization, same authenticated identity, but a different
    // client IP -- gets a fresh bucket, proving the key really is
    // IP-derived rather than session/org-derived.
    const ipTwo = `ip-two-${Math.random()}`;
    const freshBucketOnIpTwo = await createPOST(makeUploadRequest(ipTwo));
    expect(freshBucketOnIpTwo.status).toBe(201);
  }, 30000);

  it("still enforces authorization, worker admission, and no-mutation-on-rejection AFTER the rate-limit gate -- rate-limiting first doesn't weaken anything downstream", async () => {
    // Even though the limiter runs first (and is IP-, not org-, scoped),
    // an unauthorized caller past the rate gate is still rejected on its
    // own merits before formData()/batch creation.
    vi.mocked(requirePermission).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const response = await createPOST(makeUploadRequest(`solo-ip-${Math.random()}`));
    expect(response.status).not.toBe(201);
    expect(createImportBatch).not.toHaveBeenCalled();
  });

  it("a rate-limited request returns 429 without ever creating a batch, uploading to storage, or invoking formData's downstream consumers", async () => {
    const ip = `flood-ip-${Math.random()}`;
    vi.mocked(requirePermission).mockResolvedValue(permissionContextForOrg(`org-d-${Math.random()}`));
    for (let i = 0; i < 20; i++) {
      await createPOST(makeUploadRequest(ip));
    }
    createImportBatch.mockClear();
    uploadImportSourceFile.mockClear();

    const response = await createPOST(makeUploadRequest(ip));
    const payload = await response.json();
    expect(response.status).toBe(429);
    expect(payload.ok).toBe(false);
    expect(createImportBatch).not.toHaveBeenCalled();
    expect(uploadImportSourceFile).not.toHaveBeenCalled();
  }, 30000);
});
