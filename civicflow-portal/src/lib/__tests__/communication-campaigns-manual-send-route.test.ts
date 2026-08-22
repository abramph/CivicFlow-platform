import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));

const requirePermission = vi.fn();
vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return { ...actual, requirePermission: (...args: unknown[]) => requirePermission(...args) };
});

const updateManyCampaign = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { communicationCampaign: { updateMany: (...args: unknown[]) => updateManyCampaign(...args) } },
}));

const sendCommunicationCampaign = vi.fn();
vi.mock("@/lib/communication-campaigns", () => ({
  sendCommunicationCampaign: (...args: unknown[]) => sendCommunicationCampaign(...args),
}));

import { POST } from "@/app/api/communications/campaigns/[id]/send/route";

function buildRequest() {
  return new Request("https://app.getunestra.com/api/communications/campaigns/campaign-1/send", { method: "POST" });
}

describe("POST /api/communications/campaigns/[id]/send — manual retry of a FAILED campaign", () => {
  beforeEach(() => {
    requirePermission.mockReset().mockResolvedValue({
      session: { userId: "user-1", userEmail: "staff@example.com" },
      organizationId: "org-a",
    });
    updateManyCampaign.mockReset().mockResolvedValue({ count: 0 });
    sendCommunicationCampaign.mockReset().mockResolvedValue({ sent: 1, skipped: 0, failed: 0, remainingPending: 0, complete: true });
  });

  it("E2E-6 regression: resets a FAILED campaign to READY before calling sendCommunicationCampaign — otherwise its own SENT/FAILED short-circuit would silently no-op every manual retry, for ANY failure reason (billing, plan feature, WhatsApp)", async () => {
    const response = await POST(buildRequest(), { params: Promise.resolve({ id: "campaign-1" }) });
    const body = await response.json();

    expect(updateManyCampaign).toHaveBeenCalledWith({
      where: { id: "campaign-1", organizationId: "org-a", status: "FAILED" },
      data: { status: "READY" },
    });
    expect(sendCommunicationCampaign).toHaveBeenCalledWith({
      organizationId: "org-a",
      campaignId: "campaign-1",
      actorUserId: "user-1",
      actorEmail: "staff@example.com",
    });
    expect(body.data.complete).toBe(true);
  });

  it("still respects the billing gate — a manual retry for a still-inactive organization fails again (withApiErrorHandling turns the throw into a 500, not a silent success)", async () => {
    sendCommunicationCampaign.mockRejectedValueOnce(new Error("This organization's Unestra subscription is not active."));

    const response = await POST(buildRequest(), { params: Promise.resolve({ id: "campaign-1" }) });

    expect(response.status).toBe(500);
    expect(sendCommunicationCampaign).toHaveBeenCalled();
  });

  it("the reset is a harmless no-op for a campaign that isn't currently FAILED (e.g. READY) — the where clause's status:'FAILED' filter only ever matches a FAILED row", async () => {
    updateManyCampaign.mockResolvedValueOnce({ count: 0 });

    await POST(buildRequest(), { params: Promise.resolve({ id: "campaign-1" }) });

    expect(updateManyCampaign).toHaveBeenCalledWith({
      where: { id: "campaign-1", organizationId: "org-a", status: "FAILED" },
      data: { status: "READY" },
    });
    // sendCommunicationCampaign is still called normally regardless of
    // whether the reset actually matched a row.
    expect(sendCommunicationCampaign).toHaveBeenCalledTimes(1);
  });
});
