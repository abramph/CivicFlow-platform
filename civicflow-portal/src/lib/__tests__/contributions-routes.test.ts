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
const findFirstCampaign = vi.fn();
const findFirstEvent = vi.fn();
const createContribution = vi.fn();
const findManyContribution = vi.fn();
const findFirstContribution = vi.fn();
const updateContribution = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: { findFirst: (...args: unknown[]) => findFirstOrgMember(...args) },
    campaign: { findFirst: (...args: unknown[]) => findFirstCampaign(...args) },
    event: { findFirst: (...args: unknown[]) => findFirstEvent(...args) },
    contribution: {
      create: (...args: unknown[]) => createContribution(...args),
      findMany: (...args: unknown[]) => findManyContribution(...args),
      findFirst: (...args: unknown[]) => findFirstContribution(...args),
      update: (...args: unknown[]) => updateContribution(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/member-timeline", () => ({ createMemberTimelineEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/contributions/route";
import { POST as VOID } from "@/app/api/contributions/[id]/void/route";

function postRequest(body: Record<string, unknown>) {
  return new Request("https://portal.test/api/contributions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function voidRequest(body: Record<string, unknown> = {}) {
  return new Request("https://portal.test/api/contributions/contribution-1/void", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  campaignId: "campaign-1",
  amount: 100,
  contributionDate: "2026-01-15T00:00:00.000Z",
  source: "CAMPAIGN_PAGE",
};

describe("POST /api/contributions", () => {
  beforeEach(() => {
    findFirstOrgMember.mockReset();
    findFirstCampaign.mockReset();
    findFirstEvent.mockReset();
    createContribution.mockReset();
  });

  it("rejects a contribution attributed to nothing (no member, campaign, or event)", async () => {
    const response = await POST(
      postRequest({ amount: 100, contributionDate: "2026-01-15T00:00:00.000Z", source: "MANUAL" })
    );
    expect(response.status).toBe(400);
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("404s when campaignId doesn't belong to the caller's organization", async () => {
    findFirstCampaign.mockResolvedValueOnce(null);

    const response = await POST(postRequest(validBody));

    expect(response.status).toBe(404);
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("404s when memberId doesn't belong to the caller's organization", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ ...validBody, campaignId: null, memberId: "member-other-org" }));

    expect(response.status).toBe(404);
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("404s when eventId doesn't belong to the caller's organization", async () => {
    findFirstEvent.mockResolvedValueOnce(null);

    const response = await POST(postRequest({ ...validBody, campaignId: null, eventId: "event-other-org" }));

    expect(response.status).toBe(404);
    expect(createContribution).not.toHaveBeenCalled();
  });

  it("creates a contribution scoped to the caller's organization on success", async () => {
    findFirstCampaign.mockResolvedValueOnce({ id: "campaign-1", organizationId: "org-a" });
    createContribution.mockResolvedValueOnce({
      id: "contribution-1",
      amount: 100,
      source: "CAMPAIGN_PAGE",
      memberId: null,
      campaignId: "campaign-1",
      eventId: null,
      paymentMethod: null,
      receiptRequested: false,
    });

    const response = await POST(postRequest(validBody));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(createContribution).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-a", campaignId: "campaign-1" }) })
    );
  });
});

describe("GET /api/contributions", () => {
  it("scopes the query to the caller's organization", async () => {
    findManyContribution.mockResolvedValueOnce([]);
    await GET();
    expect(findManyContribution).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });
});

describe("POST /api/contributions/[id]/void", () => {
  beforeEach(() => {
    findFirstContribution.mockReset();
    updateContribution.mockReset();
  });

  it("404s when the contribution doesn't belong to the caller's organization", async () => {
    findFirstContribution.mockResolvedValueOnce(null);

    const response = await VOID(voidRequest(), { params: Promise.resolve({ id: "contribution-1" }) });

    expect(response.status).toBe(404);
    expect(updateContribution).not.toHaveBeenCalled();
  });

  it("rejects voiding a contribution that's already voided", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "contribution-1", organizationId: "org-a", voidedAt: new Date(), lockedAt: null, amount: 100, memberId: null });

    const response = await VOID(voidRequest(), { params: Promise.resolve({ id: "contribution-1" }) });

    expect(response.status).toBe(400);
    expect(updateContribution).not.toHaveBeenCalled();
  });

  it("rejects voiding a locked contribution, even by an org admin", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "contribution-1", organizationId: "org-a", voidedAt: null, lockedAt: new Date(), amount: 100, memberId: null });

    const response = await VOID(voidRequest(), { params: Promise.resolve({ id: "contribution-1" }) });

    expect(response.status).toBe(400);
    expect(updateContribution).not.toHaveBeenCalled();
  });

  it("voids an unlocked, not-yet-voided contribution", async () => {
    findFirstContribution.mockResolvedValueOnce({ id: "contribution-1", organizationId: "org-a", voidedAt: null, lockedAt: null, amount: 100, memberId: null });
    updateContribution.mockResolvedValueOnce({ id: "contribution-1", voidedAt: new Date() });

    const response = await VOID(voidRequest({ reason: "Duplicate entry" }), { params: Promise.resolve({ id: "contribution-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(updateContribution).toHaveBeenCalledWith({
      where: { id: "contribution-1" },
      data: expect.objectContaining({ voidReason: "Duplicate entry" }),
    });
  });
});
