import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * fix/pta-treasurer-financial-controls follow-up — the Treasurer exposes
 * the shared, generic direct-Expenditure workflow (create/edit/void), so
 * its financial mutation and audit event must be as atomic as the
 * reimbursement PAID/VOIDED/REVERSED transitions. Before this fix, both
 * POST /api/expenditures and PATCH /api/expenditures/:id wrote the
 * Expenditure and its audit event as two separate, non-transactional
 * calls.
 */

const requirePermission = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findFirstCategory = vi.fn();
const findFirstPaymentMethod = vi.fn();
const findFirstCampaign = vi.fn();
const findFirstEvent = vi.fn();
const findFirstExpenditure = vi.fn();
const transaction = vi.fn();
const txCreateExpenditure = vi.fn();
const txUpdateExpenditure = vi.fn();
const getFinancialEditPolicy = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findFirst: (...a: unknown[]) => findFirstCategory(...a) },
    paymentMethodConfig: { findFirst: (...a: unknown[]) => findFirstPaymentMethod(...a) },
    campaign: { findFirst: (...a: unknown[]) => findFirstCampaign(...a) },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
    expenditure: { findFirst: (...a: unknown[]) => findFirstExpenditure(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/financial-edit-policy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/financial-edit-policy")>("@/lib/financial-edit-policy");
  return { ...actual, getFinancialEditPolicy: (...a: unknown[]) => getFinancialEditPolicy(...a) };
});

import { POST } from "@/app/api/expenditures/route";
import { PATCH } from "@/app/api/expenditures/[id]/route";

function postRequest(body: unknown) {
  return new Request("https://portal.test/api/expenditures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function patchRequest(body: unknown) {
  return new Request("https://portal.test/api/expenditures/exp-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const session = { userId: "treasurer-1", userEmail: "treasurer@example.org" };

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ session, organizationId: "org-1", role: "FINANCE" });
  findFirstCategory.mockResolvedValue(null);
  findFirstPaymentMethod.mockResolvedValue(null);
  findFirstCampaign.mockResolvedValue(null);
  findFirstEvent.mockResolvedValue(null);
  txCreateExpenditure.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "exp-1",
    amount: 42.5,
    date: new Date("2026-08-31T00:00:00.000Z"),
    ...args.data,
  }));
  txUpdateExpenditure.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "exp-1", ...args.data }));
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      expenditure: {
        create: (...a: unknown[]) => txCreateExpenditure(...a),
        update: (...a: unknown[]) => txUpdateExpenditure(...a),
      },
    })
  );
  getFinancialEditPolicy.mockResolvedValue({
    editWindowHours: 24,
    requireReasonForFinancialEdits: true,
    allowFinanceCorrections: true,
    lockReceiptsAfterIssue: true,
  });
});

describe("POST /api/expenditures", () => {
  it("creates the Expenditure and its audit event inside the same transaction", async () => {
    const response = await POST(
      postRequest({ date: "2026-08-31T00:00:00.000Z", amount: 42.5, description: "Poster paper", vendor: "Casey Chair" })
    );
    expect(response.status).toBe(201);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txCreateExpenditure.mock.invocationCallOrder[0]).toBeLessThan(createAuditEvent.mock.invocationCallOrder[0]);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "create", entityType: "expenditure", tx: expect.anything() }));
  });
});

describe("PATCH /api/expenditures/:id", () => {
  const existing = {
    id: "exp-1",
    organizationId: "org-1",
    createdAt: new Date(), // well inside the default 24h edit window regardless of when this test runs
    lockedAt: null,
    voidedAt: null,
    receiptUrl: "https://spaces.example/private/receipt-exp-1.pdf",
    amount: 42.5,
  };

  it("updates the Expenditure and its audit event inside the same transaction, and excludes receiptUrl from audit metadata", async () => {
    findFirstExpenditure.mockResolvedValueOnce(existing);
    const response = await PATCH(patchRequest({ description: "Corrected description" }), { params: Promise.resolve({ id: "exp-1" }) });
    expect(response.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "update", tx: expect.anything() }));

    const metadata = createAuditEvent.mock.calls[0][0].metadata as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(metadata.before).not.toHaveProperty("receiptUrl");
    expect(metadata.after).not.toHaveProperty("receiptUrl");
  });

  it("voiding uses a distinct audit action, still inside the same transaction", async () => {
    findFirstExpenditure.mockResolvedValueOnce(existing);
    txUpdateExpenditure.mockResolvedValueOnce({ id: "exp-1", voidedAt: new Date(), voidReason: "Duplicate entry" });
    const response = await PATCH(patchRequest({ voidReason: "Duplicate entry" }), { params: Promise.resolve({ id: "exp-1" }) });
    expect(response.status).toBe(200);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "void", tx: expect.anything() }));
  });

  it("a locked/expired-window record without a privileged reason is rejected before any write", async () => {
    findFirstExpenditure.mockResolvedValueOnce({ ...existing, createdAt: new Date("2020-01-01T00:00:00.000Z") });
    requirePermission.mockResolvedValueOnce({ session, organizationId: "org-1", role: "STAFF" });
    const response = await PATCH(patchRequest({ description: "Should be blocked" }), { params: Promise.resolve({ id: "exp-1" }) });
    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });
});
