import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@org-a.example.com" },
      organizationId: "org-a",
    }),
  };
});

const findFirstOrgMember = vi.fn();
const updateManyOrgMember = vi.fn();
const findUniqueOrThrowOrgMember = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...a: unknown[]) => findFirstOrgMember(...a),
      updateMany: (...a: unknown[]) => updateManyOrgMember(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrowOrgMember(...a),
    },
    category: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push", () => ({ sendPushToMember: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { PATCH } from "@/app/api/members/[id]/route";

function patchReq(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/members/member-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ id: "member-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateManyOrgMember.mockResolvedValue({ count: 1 });
});

describe("PATCH /api/members/[id] — terminated is no longer reachable through the generic edit route", () => {
  it("rejects setting membershipStatus to terminated, directing the caller to the dedicated action", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "active" });

    const response = await PATCH(patchReq({ membershipStatus: "terminated", statusChangeReason: "Some reason" }), params());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Terminate action/);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("rejects moving a terminated member to any other status, directing the caller to the Reinstate action", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "terminated" });

    const response = await PATCH(patchReq({ membershipStatus: "active" }), params());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/Reinstate action/);
    expect(updateManyOrgMember).not.toHaveBeenCalled();
  });

  it("still allows editing other fields of a terminated member without touching status", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "terminated", email: "old@example.com" });
    findUniqueOrThrowOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "terminated", email: "new@example.com" });

    const response = await PATCH(patchReq({ email: "new@example.com" }), params());

    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "member-1", organizationId: "org-a", membershipStatus: "terminated" }),
        data: expect.objectContaining({ email: "new@example.com" }),
      })
    );
  });

  it("still allows ordinary non-terminated status transitions unaffected by the new guard", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "active" });
    findUniqueOrThrowOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "inactive" });

    const response = await PATCH(patchReq({ membershipStatus: "inactive" }), params());

    expect(response.status).toBe(200);
    expect(updateManyOrgMember).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ membershipStatus: "inactive" }) }));
  });

  it("rejects with 409 when the member's status changed between the read and the write (compare-and-swap loss)", async () => {
    // Simulates a concurrent dedicated terminate/reinstate call landing between
    // this route's findFirst and its write -- found by independent review as a
    // real TOCTOU gap (the old code used a plain update() with no status guard).
    findFirstOrgMember.mockResolvedValueOnce({ id: "member-1", organizationId: "org-a", membershipStatus: "active", email: "old@example.com" });
    updateManyOrgMember.mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(patchReq({ email: "new@example.com" }), params());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toMatch(/changed since you loaded this page/);
    expect(findUniqueOrThrowOrgMember).not.toHaveBeenCalled();
  });
});
