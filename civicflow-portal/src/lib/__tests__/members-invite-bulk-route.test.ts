import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "staff-1", userEmail: "staff@example.com" },
      organizationId: "org-a",
      role: "ORG_ADMIN",
    }),
  };
});

const findManyOrgMember = vi.fn();
const findManyMemberInvite = vi.fn().mockResolvedValue([]);
const findUniqueOrganization = vi.fn().mockResolvedValue({ name: "ThrivePath Foundation" });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findMany: (...args: unknown[]) => findManyOrgMember(...args) },
    memberInvite: { findMany: (...args: unknown[]) => findManyMemberInvite(...args) },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
  },
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const sendMemberAppInviteEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/member-invites", () => ({
  sendMemberAppInviteEmail: (...args: unknown[]) => sendMemberAppInviteEmail(...args),
}));

import { POST } from "@/app/api/members/invite-bulk/route";

function jsonRequest(body: unknown) {
  return new Request("https://portal.test/api/members/invite-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/members/invite-bulk", () => {
  beforeEach(() => {
    findManyOrgMember.mockReset();
    findManyMemberInvite.mockReset();
    findManyMemberInvite.mockResolvedValue([]);
    sendMemberAppInviteEmail.mockClear();
    sendMemberAppInviteEmail.mockResolvedValue(undefined);
  });

  it("preview mode reports counts without sending anything", async () => {
    findManyOrgMember.mockResolvedValueOnce([
      { id: "m1", email: "a@example.com", userId: null },
      { id: "m2", email: null, userId: null }, // no email
      { id: "m3", email: "c@example.com", userId: "user-3" }, // already linked
    ]);

    const response = await POST(jsonRequest({ preview: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ matching: 3, eligible: 1, alreadyLinked: 1, noEmail: 1, alreadyPending: 0 });
    expect(sendMemberAppInviteEmail).not.toHaveBeenCalled();
  });

  it("excludes members with an already-pending, unexpired invite", async () => {
    findManyOrgMember.mockResolvedValueOnce([
      { id: "m1", email: "a@example.com", userId: null },
      { id: "m2", email: "b@example.com", userId: null },
    ]);
    findManyMemberInvite.mockResolvedValueOnce([{ memberId: "m1" }]);

    const response = await POST(jsonRequest({ preview: true }));
    const body = await response.json();

    expect(body.data.eligible).toBe(1);
    expect(body.data.alreadyPending).toBe(1);
  });

  it("sends invites to eligible members and reports invited/failed counts", async () => {
    findManyOrgMember.mockResolvedValueOnce([
      { id: "m1", email: "a@example.com", userId: null },
      { id: "m2", email: "b@example.com", userId: null },
    ]);
    sendMemberAppInviteEmail.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SMTP down"));

    const response = await POST(jsonRequest({ preview: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(sendMemberAppInviteEmail).toHaveBeenCalledTimes(2);
    expect(body.data.invited).toBe(1);
    expect(body.data.failed).toBe(1);
    expect(body.data.remaining).toBe(0);
  });

  it("caps the number of invites sent per request and reports the remainder", async () => {
    const manyMembers = Array.from({ length: 305 }, (_, i) => ({ id: `m${i}`, email: `m${i}@example.com`, userId: null }));
    findManyOrgMember.mockResolvedValueOnce(manyMembers);

    const response = await POST(jsonRequest({ preview: false }));
    const body = await response.json();

    expect(sendMemberAppInviteEmail).toHaveBeenCalledTimes(300);
    expect(body.data.invited).toBe(300);
    expect(body.data.remaining).toBe(5);
  });

  it("scopes the query to the caller's own organization", async () => {
    findManyOrgMember.mockResolvedValueOnce([]);

    await POST(jsonRequest({ filters: { city: "Philadelphia" }, preview: true }));

    expect(findManyOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-a" }) })
    );
  });
});
