import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueSettings = vi.fn();
const findFirstCategory = vi.fn();
const findFirstEvent = vi.fn();
const findFirstCommittee = vi.fn();
const findFirstRequest = vi.fn();
const findManyRequests = vi.fn();
const findFirstPaymentMethod = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

// Shared tx-scoped mocks -- every `prisma.$transaction(async (tx) => ...)`
// call site in reimbursements.ts is routed through this same fake `tx`
// object, mirroring how the real CAS-guarded code always does its
// money-moving writes inside one transaction.
const txCreateRequest = vi.fn();
const txUpdateRequest = vi.fn();
const txUpdateManyRequest = vi.fn();
const txFindFirstRequest = vi.fn();
const txCreateExpenditure = vi.fn();
const txUpdateExpenditure = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueSettings(...a) },
    category: { findFirst: (...a: unknown[]) => findFirstCategory(...a) },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
    ptaCommittee: { findFirst: (...a: unknown[]) => findFirstCommittee(...a) },
    paymentMethodConfig: { findFirst: (...a: unknown[]) => findFirstPaymentMethod(...a) },
    reimbursementRequest: {
      findFirst: (...a: unknown[]) => findFirstRequest(...a),
      findMany: (...a: unknown[]) => findManyRequests(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import { createReimbursement, listReimbursements, transitionReimbursement } from "@/lib/reimbursements";

const actor = { actorUserId: "treasurer-1", actorEmail: "treasurer@example.org" };

beforeEach(() => {
  vi.clearAllMocks();
  findUniqueSettings.mockResolvedValue({ reimbursementApprovalThreshold: null });
  txCreateRequest.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "r-1", ...args.data }));
  txUpdateRequest.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "r-1", ...args.data }));
  txUpdateManyRequest.mockResolvedValue({ count: 1 });
  txCreateExpenditure.mockResolvedValue({ id: "exp-1" });
  txUpdateExpenditure.mockResolvedValue({ id: "exp-1", voidedAt: new Date() });
  findFirstPaymentMethod.mockResolvedValue({ id: "pm-1", isActive: true });
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      reimbursementRequest: {
        create: (...a: unknown[]) => txCreateRequest(...a),
        update: (...a: unknown[]) => txUpdateRequest(...a),
        updateMany: (...a: unknown[]) => txUpdateManyRequest(...a),
        findFirst: (...a: unknown[]) => txFindFirstRequest(...a),
      },
      expenditure: {
        create: (...a: unknown[]) => txCreateExpenditure(...a),
        update: (...a: unknown[]) => txUpdateExpenditure(...a),
      },
    })
  );
});

describe("createReimbursement", () => {
  it("requires payee, description, and a positive amount", async () => {
    await expect(createReimbursement({ organizationId: "org-1", payeeName: " ", description: "x", amount: 5, ...actor })).rejects.toMatchObject({
      name: "FinanceError",
    });
    await expect(createReimbursement({ organizationId: "org-1", payeeName: "Pat", description: "x", amount: 0, ...actor })).rejects.toMatchObject({
      name: "FinanceError",
    });
  });

  it("starts SUBMITTED at or below the org threshold, UNDER_REVIEW above it", async () => {
    findUniqueSettings.mockResolvedValue({ reimbursementApprovalThreshold: 100 });
    const small = await createReimbursement({ organizationId: "org-1", payeeName: "Pat", description: "Supplies", amount: 100, ...actor });
    expect(small.status).toBe("SUBMITTED");
    const large = await createReimbursement({ organizationId: "org-1", payeeName: "Pat", description: "Venue", amount: 100.01, ...actor });
    expect(large.status).toBe("UNDER_REVIEW");
  });

  it("category must be an expenditure category of this organization", async () => {
    findFirstCategory.mockResolvedValueOnce(null);
    await expect(
      createReimbursement({ organizationId: "org-1", payeeName: "Pat", description: "x", amount: 5, categoryId: "foreign", ...actor })
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirstCategory.mock.calls[0][0].where).toMatchObject({ organizationId: "org-1", type: "EXPENDITURE" });
  });

  it("submit and its audit event commit in the same transaction", async () => {
    await createReimbursement({ organizationId: "org-1", payeeName: "Pat", description: "Supplies", amount: 50, ...actor });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reimbursement.submitted", tx: expect.anything() }));
  });
});

describe("transitions — ordinary review stages", () => {
  it("self-approval is forbidden regardless of permissions", async () => {
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "SUBMITTED", submittedByUserId: "treasurer-1", amount: 50 });
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "APPROVED", ...actor })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejection requires a reason", async () => {
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "SUBMITTED", submittedByUserId: "someone-else", amount: 50 });
    await expect(transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "REJECTED", ...actor })).rejects.toMatchObject({
      name: "FinanceError",
    });
  });

  it("terminal states cannot move", async () => {
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "REJECTED", submittedByUserId: "x", amount: 5 });
    await expect(transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "UNDER_REVIEW", ...actor })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("approve and its audit event commit in the same transaction", async () => {
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "SUBMITTED", submittedByUserId: "someone-else", amount: 50 });
    await transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "APPROVED", ...actor });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reimbursement.approved", tx: expect.anything() }));
  });
});

describe("transitions — mark paid", () => {
  const approved = { id: "r-9", status: "APPROVED", submittedByUserId: "chair-1", amount: 42.5, description: "Poster paper", payeeName: "Casey Chair", categoryId: "cat-1", eventId: "evt-1", expenditureId: null };

  it("requires a payment method before ever starting the transaction", async () => {
    findFirstRequest.mockResolvedValueOnce(approved);
    await expect(transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "PAID", ...actor })).rejects.toMatchObject({
      name: "FinanceError",
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects an inactive or cross-org payment method", async () => {
    findFirstRequest.mockResolvedValueOnce(approved);
    findFirstPaymentMethod.mockResolvedValueOnce(null);
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "PAID", paymentMethodId: "pm-foreign", ...actor })
    ).rejects.toMatchObject({ status: 400 });
    expect(findFirstPaymentMethod.mock.calls[0][0].where).toMatchObject({ id: "pm-foreign", organizationId: "org-1", isActive: true });
  });

  it("cannot mark your own request paid", async () => {
    findFirstRequest.mockResolvedValueOnce({ ...approved, submittedByUserId: "treasurer-1" });
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "PAID", paymentMethodId: "pm-1", ...actor })
    ).rejects.toMatchObject({ status: 403 });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("PAID atomically claims the row, books the Expenditure with the payment method, links it, and audits inside the same transaction", async () => {
    findFirstRequest.mockResolvedValueOnce(approved);

    const result = await transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "PAID", paymentMethodId: "pm-1", ...actor });

    expect(txUpdateManyRequest.mock.calls[0][0].where).toMatchObject({ id: "r-9", organizationId: "org-1", status: "APPROVED" });
    expect(txCreateExpenditure.mock.calls[0][0].data).toMatchObject({
      organizationId: "org-1",
      vendor: "Casey Chair",
      categoryId: "cat-1",
      eventId: "evt-1",
      paymentMethodId: "pm-1",
    });
    expect(txCreateExpenditure.mock.calls[0][0].data.reference).toBe("REIMB-r-9");
    expect(txUpdateRequest.mock.calls[0][0].data).toMatchObject({ expenditureId: "exp-1" });
    expect(result.expenditureId).toBe("exp-1");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reimbursement.paid", tx: expect.anything() }));
  });

  it("a losing concurrent claim (updateMany count 0) never creates an Expenditure and returns a stable conflict", async () => {
    findFirstRequest.mockResolvedValueOnce(approved);
    txUpdateManyRequest.mockResolvedValueOnce({ count: 0 });
    findFirstRequest.mockResolvedValueOnce({ ...approved, status: "PAID" }); // re-read after the lost claim

    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "PAID", paymentMethodId: "pm-1", ...actor })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already been marked paid") });
    expect(txCreateExpenditure).not.toHaveBeenCalled();
  });

  it("an audit failure rolls back — the transaction callback throws before returning, so nothing commits", async () => {
    findFirstRequest.mockResolvedValueOnce(approved);
    createAuditEvent.mockRejectedValueOnce(new Error("audit db down"));

    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "PAID", paymentMethodId: "pm-1", ...actor })
    ).rejects.toThrow("audit db down");
    // The mocked $transaction always "commits" whatever the callback
    // returns, so this proves the callback itself throws (and therefore a
    // real prisma.$transaction would roll back) rather than swallowing the
    // audit error.
  });
});

describe("transitions — void and reversal", () => {
  const paid = { id: "r-9", status: "PAID", submittedByUserId: "chair-1", amount: 42.5, expenditureId: "exp-1" };

  it("requires a reason", async () => {
    findFirstRequest.mockResolvedValueOnce(paid);
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "VOIDED", confirmText: "VOID", ...actor })
    ).rejects.toMatchObject({ name: "FinanceError" });
  });

  it("requires exact typed confirmation", async () => {
    findFirstRequest.mockResolvedValueOnce(paid);
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "VOIDED", correctionReason: "mistake", confirmText: "void", ...actor })
    ).rejects.toMatchObject({ name: "FinanceError" });
    findFirstRequest.mockResolvedValueOnce(paid);
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "REVERSED", correctionReason: "bank clawback", confirmText: "VOID", ...actor })
    ).rejects.toMatchObject({ name: "FinanceError" });
  });

  it("the submitter cannot void or reverse their own paid request", async () => {
    findFirstRequest.mockResolvedValueOnce({ ...paid, submittedByUserId: "treasurer-1" });
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "VOIDED", correctionReason: "mistake", confirmText: "VOID", ...actor })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("VOID atomically claims the row, voids the linked Expenditure, and audits inside the same transaction", async () => {
    findFirstRequest.mockResolvedValueOnce(paid);
    txFindFirstRequest.mockResolvedValueOnce({ ...paid, status: "VOIDED", correctionType: "VOID" });

    const result = await transitionReimbursement({
      organizationId: "org-1",
      requestId: "r-9",
      status: "VOIDED",
      correctionReason: "Marked paid by mistake",
      confirmText: "VOID",
      ...actor,
    });

    expect(txUpdateManyRequest.mock.calls[0][0].where).toMatchObject({ id: "r-9", organizationId: "org-1", status: "PAID" });
    expect(txUpdateManyRequest.mock.calls[0][0].data).toMatchObject({ status: "VOIDED", correctionType: "VOID", correctedByUserId: "treasurer-1" });
    expect(txUpdateExpenditure.mock.calls[0][0]).toMatchObject({ where: { id: "exp-1" }, data: expect.objectContaining({ voidedByUserId: "treasurer-1" }) });
    expect(result.status).toBe("VOIDED");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reimbursement.voided", tx: expect.anything() }));
  });

  it("REVERSED behaves the same way with its own audit action", async () => {
    findFirstRequest.mockResolvedValueOnce(paid);
    txFindFirstRequest.mockResolvedValueOnce({ ...paid, status: "REVERSED", correctionType: "REVERSAL" });

    await transitionReimbursement({
      organizationId: "org-1",
      requestId: "r-9",
      status: "REVERSED",
      correctionReason: "Bank later clawed back the check",
      confirmText: "REVERSE",
      ...actor,
    });

    expect(txUpdateManyRequest.mock.calls[0][0].data).toMatchObject({ status: "REVERSED", correctionType: "REVERSAL" });
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reimbursement.reversed", tx: expect.anything() }));
  });

  it("a losing concurrent claim never voids the Expenditure twice and returns a stable conflict", async () => {
    findFirstRequest.mockResolvedValueOnce(paid);
    txUpdateManyRequest.mockResolvedValueOnce({ count: 0 });
    findFirstRequest.mockResolvedValueOnce({ ...paid, status: "VOIDED" });

    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "VOIDED", correctionReason: "mistake", confirmText: "VOID", ...actor })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("already been voided") });
    expect(txUpdateExpenditure).not.toHaveBeenCalled();
  });

  it("VOIDED and REVERSED are terminal — cannot transition again", async () => {
    findFirstRequest.mockResolvedValueOnce({ ...paid, status: "VOIDED" });
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "REVERSED", correctionReason: "x", confirmText: "REVERSE", ...actor })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("listReimbursements scoping", () => {
  it("non-managers are pinned to their own submissions in the query itself", async () => {
    findManyRequests.mockResolvedValueOnce([]);
    await listReimbursements("org-1", { userId: "chair-1", canManage: false });
    expect(findManyRequests.mock.calls[0][0].where).toMatchObject({ organizationId: "org-1", submittedByUserId: "chair-1" });

    findManyRequests.mockResolvedValueOnce([]);
    await listReimbursements("org-1", { userId: "treasurer-1", canManage: true });
    expect(findManyRequests.mock.calls[1][0].where.submittedByUserId).toBeUndefined();
  });
});
