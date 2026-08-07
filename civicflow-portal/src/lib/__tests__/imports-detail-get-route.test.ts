import { beforeEach, describe, expect, it, vi } from "vitest";

function permissionContext(allowed: string[]) {
  return {
    session: { userId: "officer-1", userEmail: "officer@example.com" },
    organizationId: "org-a",
    role: "ORG_ADMIN",
    can: (permission: string) => allowed.includes(permission),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue(permissionContext(["imports:read"])),
  };
});

const findFirstImportBatch = vi.fn();
const findManyImportRow = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: { findFirst: (...args: unknown[]) => findFirstImportBatch(...args) },
    importRow: { findMany: (...args: unknown[]) => findManyImportRow(...args) },
  },
}));

const attachFieldComparisons = vi.fn();
vi.mock("@/lib/imports/duplicate-matching", () => ({
  attachFieldComparisons: (...args: unknown[]) => attachFieldComparisons(...args),
}));

vi.mock("@/lib/imports/row-normalization", () => ({
  formatRowIdentity: () => ({ displayName: "Test", displaySubtitle: null }),
}));

import { requirePermission } from "@/lib/auth-guards";
import { GET } from "@/app/api/imports/[id]/route";

function makeRequest() {
  return new Request("https://portal.test/api/imports/batch-1", { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyImportRow.mockResolvedValue([]);
  attachFieldComparisons.mockResolvedValue([]);
});

describe("GET /api/imports/[id] — PR C read-side domain permission gate", () => {
  it("returns the batch for a COMMUNITY_MEMBERS batch with only generic imports:read (unchanged behavior)", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:read"]));
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", importKind: "COMMUNITY_MEMBERS" });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: "batch-1" }) });
    expect(response.status).toBe(200);
  });

  it("SECURITY REGRESSION: rejects reading a PTA_HOUSEHOLDS batch for a caller with only imports:read (no pta:directory:read)", async () => {
    // Before the security-review fix, attachFieldComparisons()'s PTA branch
    // returned real primary-contact name/email/phone to any imports:read
    // holder, bypassing the pta:directory:read gate that protects this same
    // data everywhere else in the app.
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:read"]));
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", importKind: "PTA_HOUSEHOLDS" });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: "batch-1" }) });
    expect(response.status).toBe(403);
    expect(attachFieldComparisons).not.toHaveBeenCalled();
  });

  it("allows reading a PTA_HOUSEHOLDS batch for a caller with imports:read AND pta:directory:read", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:read", "pta:directory:read"]));
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", importKind: "PTA_HOUSEHOLDS" });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: "batch-1" }) });
    expect(response.status).toBe(200);
  });

  it("SECURITY REGRESSION: rejects reading an HOA_PROPERTIES batch for a caller missing hoa:residents:read (only hoa:properties:read)", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:read", "hoa:properties:read"]));
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", importKind: "HOA_PROPERTIES" });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: "batch-1" }) });
    expect(response.status).toBe(403);
    expect(attachFieldComparisons).not.toHaveBeenCalled();
  });

  it("allows reading an HOA_PROPERTIES batch for a caller with both hoa:properties:read and hoa:residents:read", async () => {
    vi.mocked(requirePermission).mockResolvedValueOnce(permissionContext(["imports:read", "hoa:properties:read", "hoa:residents:read"]));
    findFirstImportBatch.mockResolvedValueOnce({ id: "batch-1", organizationId: "org-a", importKind: "HOA_PROPERTIES" });

    const response = await GET(makeRequest(), { params: Promise.resolve({ id: "batch-1" }) });
    expect(response.status).toBe(200);
  });
});
