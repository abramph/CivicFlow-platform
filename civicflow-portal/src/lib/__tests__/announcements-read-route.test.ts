import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobileMembership = vi.fn();
vi.mock("@/lib/mobile-auth", () => ({
  requireMobileMembership: (...args: unknown[]) => requireMobileMembership(...args),
}));

const updateManyRecipient = vi.fn().mockResolvedValue({ count: 1 });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationRecipient: {
      updateMany: (...args: unknown[]) => updateManyRecipient(...args),
    },
  },
}));

import { POST } from "@/app/api/mobile/announcements/[id]/read/route";

describe("POST /api/mobile/announcements/[id]/read", () => {
  beforeEach(() => {
    requireMobileMembership.mockReset();
    updateManyRecipient.mockClear();
  });

  it("marks only the caller's own delivery record as read, scoped to their org and member id", async () => {
    requireMobileMembership.mockResolvedValueOnce({
      session: { userId: "member-user-1", email: "member@example.com" },
      organizationId: "org-a",
      memberId: "member-1",
    });

    const response = await POST(
      new Request("https://portal.test/api/mobile/announcements/campaign-1/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: "org-a" }),
      }),
      { params: Promise.resolve({ id: "campaign-1" }) }
    );

    expect(response.status).toBe(200);
    expect(updateManyRecipient).toHaveBeenCalledWith({
      where: { organizationId: "org-a", memberId: "member-1", campaignId: "campaign-1", readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
