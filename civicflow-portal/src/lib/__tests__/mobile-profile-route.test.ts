import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileMembership = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileMembership: (...args: unknown[]) => requireMobileMembership(...args),
}));

const findFirstOrgMember = vi.fn();
const updateOrgMember = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
      update: (...args: unknown[]) => updateOrgMember(...args),
    },
  },
}));

import { GET, PATCH } from "@/app/api/mobile/profile/route";

function getRequest(organizationId: string | null) {
  const url = organizationId
    ? `https://portal.test/api/mobile/profile?organizationId=${organizationId}`
    : "https://portal.test/api/mobile/profile";
  return new Request(url);
}

function patchRequest(body: unknown) {
  return new Request("https://portal.test/api/mobile/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/mobile/profile", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    findFirstOrgMember.mockReset();
  });

  it("requires organizationId", async () => {
    const response = await GET(getRequest(null));
    expect(response.status).toBe(400);
    expect(requireMobileMembership).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller's own verified member id and org", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });
    findFirstOrgMember.mockResolvedValueOnce({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "+15551234567",
      commsPushEnabled: true,
      commsEmailEnabled: true,
      commsSmsEnabled: false,
      smsOptedOutAt: null,
    });

    const response = await GET(getRequest("org-a"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(findFirstOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "member-1", organizationId: "org-a" } })
    );
    expect(body.data.commsSmsEnabled).toBe(false);
  });
});

describe("PATCH /api/mobile/profile", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    updateOrgMember.mockReset();
    updateOrgMember.mockResolvedValue({
      commsPushEnabled: true,
      commsEmailEnabled: true,
      commsSmsEnabled: true,
      smsOptedOutAt: null,
    });
  });

  it("only ever updates the caller's own verified member id, never a client-supplied one", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });

    await PATCH(patchRequest({ organizationId: "org-a", commsSmsEnabled: true }));

    expect(updateOrgMember).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "member-1" } })
    );
  });

  it("rejects an attempt to set smsOptedOutAt directly — only a real STOP/START can change it", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });

    await PATCH(patchRequest({ organizationId: "org-a", commsSmsEnabled: true, smsOptedOutAt: null }));

    const dataArg = updateOrgMember.mock.calls[0][0].data;
    expect(dataArg).not.toHaveProperty("smsOptedOutAt");
  });

  it("only applies the fields actually provided", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });

    await PATCH(patchRequest({ organizationId: "org-a", commsPushEnabled: false }));

    expect(updateOrgMember).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: { commsPushEnabled: false },
      select: expect.any(Object),
    });
  });
});
