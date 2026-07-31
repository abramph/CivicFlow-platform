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

const findManyCampaign = vi.fn();
const createCampaign = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    campaign: {
      findMany: (...args: unknown[]) => findManyCampaign(...args),
      create: (...args: unknown[]) => createCampaign(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/campaigns/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/campaigns", () => {
  beforeEach(() => {
    createCampaign.mockReset();
  });

  it("rejects an end date before the start date", async () => {
    const response = await POST(
      postRequest({
        name: "Fall Fun Run",
        status: "active",
        startDate: "2026-08-01T00:00:00.000Z",
        endDate: "2026-07-01T00:00:00.000Z",
      })
    );

    expect(response.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("creates a campaign scoped to the caller's organization", async () => {
    createCampaign.mockResolvedValueOnce({ id: "campaign-1", name: "Fall Fun Run", status: "active", goal: 5000 });

    const response = await POST(postRequest({ name: "Fall Fun Run", status: "active", goal: 5000 }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", name: "Fall Fun Run" }) })
    );
  });
});

describe("GET /api/campaigns", () => {
  it("scopes the query to the caller's organization", async () => {
    findManyCampaign.mockResolvedValueOnce([]);
    await GET();
    expect(findManyCampaign).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});
