import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
    }),
  };
});

const findFirstOrgMember = vi.fn();
const findFirstDuesCharge = vi.fn();
const createDuesAdjustment = vi.fn();
const updateDuesCharge = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    duesCharge: { findFirst: (...args: unknown[]) => findFirstDuesCharge(...args) },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        duesAdjustment: { create: (...args: unknown[]) => createDuesAdjustment(...args) },
        duesCharge: { update: (...args: unknown[]) => updateDuesCharge(...args) },
      }),
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { POST } from "@/app/api/dues/adjustments/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/dues/adjustments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  memberId: "member-1",
  adjustmentType: "WAIVER",
  amount: 60,
  reason: "Financial hardship waiver approved by board.",
};

describe("POST /api/dues/adjustments", () => {
  beforeEach(() => {
    findFirstOrgMember.mockReset();
    findFirstDuesCharge.mockReset();
    createDuesAdjustment.mockReset().mockResolvedValue({ id: "adj-1", adjustmentType: "WAIVER", amount: 60 });
    updateDuesCharge.mockReset();
  });

  it("404s when the member doesn't belong to the caller's organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(404);
    expect(createDuesAdjustment).not.toHaveBeenCalled();
  });

  it("rejects a reason shorter than the minimum length", async () => {
    const response = await POST(postRequest({ ...validBody, reason: "no" }));
    expect(response.status).toBe(400);
    expect(createDuesAdjustment).not.toHaveBeenCalled();
  });

  it("404s when duesChargeId is given but doesn't belong to this member in this organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });
    findFirstDuesCharge.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ ...validBody, duesChargeId: "charge-other-member" }));

    expect(response.status).toBe(404);
    expect(createDuesAdjustment).not.toHaveBeenCalled();
  });

  it("marks a fully-offset charge WAIVED when the adjustment type is WAIVER", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });
    findFirstDuesCharge.mockResolvedValueOnce({
      id: "charge-1",
      status: "PENDING",
      amountDue: 60,
      amountPaid: 0,
      adjustments: [],
    });

    const response = await POST(postRequest({ ...validBody, duesChargeId: "charge-1" }));

    expect(response.status).toBe(201);
    expect(updateDuesCharge).toHaveBeenCalledWith({ where: { id: "charge-1" }, data: { status: "WAIVED" } });
  });

  it("marks a fully-offset charge PAID (not WAIVED) for a non-waiver adjustment type", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });
    findFirstDuesCharge.mockResolvedValueOnce({
      id: "charge-1",
      status: "PENDING",
      amountDue: 60,
      amountPaid: 0,
      adjustments: [],
    });

    const response = await POST(postRequest({ ...validBody, adjustmentType: "CREDIT", duesChargeId: "charge-1" }));

    expect(response.status).toBe(201);
    expect(updateDuesCharge).toHaveBeenCalledWith({ where: { id: "charge-1" }, data: { status: "PAID" } });
  });

  it("leaves the charge status unchanged when the adjustment doesn't fully offset the remaining balance", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });
    findFirstDuesCharge.mockResolvedValueOnce({
      id: "charge-1",
      status: "PENDING",
      amountDue: 200,
      amountPaid: 0,
      adjustments: [],
    });

    const response = await POST(postRequest({ ...validBody, amount: 10, duesChargeId: "charge-1" }));

    expect(response.status).toBe(201);
    expect(updateDuesCharge).toHaveBeenCalledWith({ where: { id: "charge-1" }, data: { status: "PENDING" } });
  });

  it("creates an adjustment with no linked charge when duesChargeId is omitted", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a" });

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(201);
    expect(findFirstDuesCharge).not.toHaveBeenCalled();
    expect(updateDuesCharge).not.toHaveBeenCalled();
    expect(createDuesAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ duesChargeId: null, memberId: "member-1" }) })
    );
  });
});
