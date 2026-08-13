import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueSettings = vi.fn();
const findFirstCategory = vi.fn();
const findFirstEvent = vi.fn();
const findFirstCommittee = vi.fn();
const createRequest = vi.fn();
const findFirstRequest = vi.fn();
const updateRequest = vi.fn();
const findManyRequests = vi.fn();
const txCreateExpenditure = vi.fn();
const txUpdateRequest = vi.fn();
const transaction = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgSettings: { findUnique: (...a: unknown[]) => findUniqueSettings(...a) },
    category: { findFirst: (...a: unknown[]) => findFirstCategory(...a) },
    event: { findFirst: (...a: unknown[]) => findFirstEvent(...a) },
    ptaCommittee: { findFirst: (...a: unknown[]) => findFirstCommittee(...a) },
    reimbursementRequest: {
      create: (...a: unknown[]) => createRequest(...a),
      findFirst: (...a: unknown[]) => findFirstRequest(...a),
      findMany: (...a: unknown[]) => findManyRequests(...a),
      update: (...a: unknown[]) => updateRequest(...a),
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
  createRequest.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "r-1", ...args.data }));
  updateRequest.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "r-1", ...args.data }));
  transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      expenditure: { create: (...a: unknown[]) => txCreateExpenditure(...a) },
      reimbursementRequest: { update: (...a: unknown[]) => txUpdateRequest(...a) },
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
});

describe("transitions", () => {
  it("self-approval is forbidden regardless of permissions", async () => {
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "SUBMITTED", submittedByUserId: "treasurer-1", amount: 50 });
    await expect(
      transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "APPROVED", ...actor })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("PAID requires APPROVED first and rejection requires a reason", async () => {
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "SUBMITTED", submittedByUserId: "someone-else", amount: 50 });
    await expect(transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "PAID", ...actor })).rejects.toMatchObject({
      status: 409,
    });
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "SUBMITTED", submittedByUserId: "someone-else", amount: 50 });
    await expect(transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "REJECTED", ...actor })).rejects.toMatchObject({
      name: "FinanceError",
    });
  });

  it("PAID books an Expenditure transactionally and links it", async () => {
    findFirstRequest.mockResolvedValueOnce({
      id: "r-9",
      status: "APPROVED",
      submittedByUserId: "chair-1",
      amount: 42.5,
      description: "Poster paper",
      payeeName: "Casey Chair",
      categoryId: "cat-1",
      eventId: "evt-1",
    });
    txCreateExpenditure.mockResolvedValueOnce({ id: "exp-1" });
    txUpdateRequest.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "r-9", ...args.data }));

    const result = await transitionReimbursement({ organizationId: "org-1", requestId: "r-9", status: "PAID", ...actor });

    expect(txCreateExpenditure.mock.calls[0][0].data).toMatchObject({
      organizationId: "org-1",
      vendor: "Casey Chair",
      categoryId: "cat-1",
      eventId: "evt-1",
    });
    expect(txCreateExpenditure.mock.calls[0][0].data.reference).toBe("REIMB-r-9");
    expect(txUpdateRequest.mock.calls[0][0].data).toMatchObject({ status: "PAID", expenditureId: "exp-1", paidByUserId: "treasurer-1" });
    expect(result.status).toBe("PAID");
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "reimbursement.paid" }));
  });

  it("terminal states cannot move", async () => {
    findFirstRequest.mockResolvedValueOnce({ id: "r-1", status: "PAID", submittedByUserId: "x", amount: 5 });
    await expect(transitionReimbursement({ organizationId: "org-1", requestId: "r-1", status: "UNDER_REVIEW", ...actor })).rejects.toMatchObject({
      status: 409,
    });
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
