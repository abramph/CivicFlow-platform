import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: (...args: unknown[]) => requirePermission(...args),
  };
});

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const batchCreate = vi.fn();
const batchUpdate = vi.fn();
const batchFindMany = vi.fn();
const itemUpsert = vi.fn();
const orgMemberFindFirst = vi.fn();
const orgMemberFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentImportBatch: {
      create: (...args: unknown[]) => batchCreate(...args),
      update: (...args: unknown[]) => batchUpdate(...args),
      findMany: (...args: unknown[]) => batchFindMany(...args),
    },
    paymentImportItem: { upsert: (...args: unknown[]) => itemUpsert(...args) },
    orgMember: {
      findFirst: (...args: unknown[]) => orgMemberFindFirst(...args),
      findMany: (...args: unknown[]) => orgMemberFindMany(...args),
    },
  },
}));

import { GET, POST } from "@/app/api/payments/imports/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/payments/imports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const authed = {
  session: { userId: "treasurer-1", userEmail: "treasurer@local408.example" },
  organizationId: "org-union-1",
  role: "FINANCE" as const,
};

describe("POST /api/payments/imports — PAYROLL_CHECKOFF source", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    batchCreate.mockReset();
    batchUpdate.mockReset();
    itemUpsert.mockReset();
    orgMemberFindFirst.mockReset();
    orgMemberFindFirst.mockResolvedValue(null);
    orgMemberFindMany.mockReset();
    orgMemberFindMany.mockResolvedValue([]);
  });

  it("requires dues:write — the same authorization gate every other import source already uses", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requirePermission.mockRejectedValueOnce(new ForbiddenError("Missing dues:write"));

    const response = await POST(postRequest({ sourceType: "PAYROLL_CHECKOFF", csvText: "a,b\n1,2" }));
    expect(response.status).toBe(403);
    expect(batchCreate).not.toHaveBeenCalled();
  });

  it("accepts PAYROLL_CHECKOFF as a valid sourceType and creates the batch scoped to the caller's organization only", async () => {
    requirePermission.mockResolvedValueOnce(authed);
    batchCreate.mockResolvedValueOnce({ id: "batch-1" });
    batchUpdate.mockResolvedValueOnce({ id: "batch-1", status: "PARSED" });

    const csvText = "Payer Email,Amount,Transaction ID\nmember1@local408.example,45.00,CHECKOFF-1\n";
    const response = await POST(postRequest({ sourceType: "PAYROLL_CHECKOFF", csvText }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(batchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-union-1", sourceType: "PAYROLL_CHECKOFF" }) })
    );
    expect(itemUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ organizationId: "org-union-1", sourceType: "PAYROLL_CHECKOFF" }),
      })
    );
  });

  it("rejects an unrecognized sourceType (schema-level enum validation, not just a client convention)", async () => {
    requirePermission.mockResolvedValueOnce(authed);
    const response = await POST(postRequest({ sourceType: "PAYROLL_ADVANCE_LOAN", csvText: "a,b\n1,2" }));
    expect(response.status).toBe(400);
    expect(batchCreate).not.toHaveBeenCalled();
  });

  it("skips a row with a non-numeric/zero amount without failing the whole batch (existing per-row behavior, unaffected by the new source type)", async () => {
    requirePermission.mockResolvedValueOnce(authed);
    batchCreate.mockResolvedValueOnce({ id: "batch-1" });
    batchUpdate.mockResolvedValueOnce({ id: "batch-1", status: "PARSED" });

    const csvText = [
      "Payer Email,Amount,Transaction ID",
      "member1@local408.example,45.00,CHECKOFF-1",
      "member2@local408.example,not-a-number,CHECKOFF-2",
    ].join("\n");
    const response = await POST(postRequest({ sourceType: "PAYROLL_CHECKOFF", csvText }));

    expect(response.status).toBe(201);
    expect(itemUpsert).toHaveBeenCalledTimes(1);
  });

  it("does not include CSV row contents in the audit event metadata", async () => {
    const { createAuditEvent } = await import("@/lib/audit");
    requirePermission.mockResolvedValueOnce(authed);
    batchCreate.mockResolvedValueOnce({ id: "batch-1" });
    batchUpdate.mockResolvedValueOnce({ id: "batch-1", status: "PARSED" });

    const csvText = "Payer Email,Amount,Transaction ID\nmember1@local408.example,45.00,CHECKOFF-1\n";
    await POST(postRequest({ sourceType: "PAYROLL_CHECKOFF", csvText }));

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ csvText: expect.anything(), rawData: expect.anything() }),
      })
    );
  });
});

describe("GET /api/payments/imports", () => {
  beforeEach(() => {
    requirePermission.mockReset();
    batchFindMany.mockReset();
  });

  it("scopes the batch list to the caller's own organization, server-resolved", async () => {
    requirePermission.mockResolvedValueOnce({ organizationId: "org-union-1" });
    batchFindMany.mockResolvedValueOnce([]);

    await GET();

    expect(batchFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-union-1" } })
    );
  });
});
