import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({
      session: { userId: "user-1", userEmail: "admin@example.com" },
      organizationId: "org-a",
      role: "ORG_OWNER",
    }),
  };
});

const getSmsEntitlement = vi.fn();
vi.mock("@/lib/sms-entitlement", () => ({
  getSmsEntitlement: (...args: unknown[]) => getSmsEntitlement(...args),
}));

const requirePlanFeature = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/plan-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/plan-gate")>();
  return {
    ...actual,
    requirePlanFeature: (...args: unknown[]) => requirePlanFeature(...args),
  };
});

const resolveCommunicationRecipients = vi.fn().mockResolvedValue([]);
const sendCommunicationCampaign = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/communication-campaigns", () => ({
  resolveCommunicationRecipients: (...args: unknown[]) => resolveCommunicationRecipients(...args),
  sendCommunicationCampaign: (...args: unknown[]) => sendCommunicationCampaign(...args),
}));

const createCampaign = vi.fn().mockResolvedValue({ id: "campaign-1", channel: "SMS", pushEnabled: false, scheduledFor: null });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    communicationCampaign: {
      create: (...args: unknown[]) => createCampaign(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/deep-links", () => ({ validateDeepLink: vi.fn(() => null) }));

import { POST } from "@/app/api/communications/campaigns/route";

function campaignRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://portal.test/api/communications/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Dues Reminder",
      communicationType: "DUES_REMINDER",
      channel: "SMS",
      subject: "Dues due",
      body: "Your dues are due.",
      ...overrides,
    }),
  });
}

describe("POST /api/communications/campaigns — SMS entitlement gate", () => {
  beforeEach(() => {
    getSmsEntitlement.mockReset();
    requirePlanFeature.mockReset();
    requirePlanFeature.mockResolvedValue(undefined);
    createCampaign.mockClear();
    resolveCommunicationRecipients.mockClear();
  });

  it("rejects creating an SMS campaign when the organization lacks the SMS add-on", async () => {
    getSmsEntitlement.mockResolvedValueOnce({
      allowed: false,
      reason: "Your organization does not have the SMS add-on enabled.",
      remaining: 0,
      limit: 0,
    });

    const response = await POST(campaignRequest({ channel: "SMS" }));

    expect(response.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("rejects creating an EMAIL_AND_SMS campaign when the organization lacks the SMS add-on", async () => {
    getSmsEntitlement.mockResolvedValueOnce({ allowed: false, reason: "No SMS add-on.", remaining: 0, limit: 0 });

    const response = await POST(campaignRequest({ channel: "EMAIL_AND_SMS" }));

    expect(response.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("allows creating an SMS campaign when the organization has the SMS add-on", async () => {
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 990, limit: 1000 });

    const response = await POST(campaignRequest({ channel: "SMS" }));

    expect(response.status).toBe(201);
    expect(createCampaign).toHaveBeenCalled();
  });

  it("never checks SMS entitlement for a pure EMAIL campaign", async () => {
    const response = await POST(campaignRequest({ channel: "EMAIL" }));

    expect(response.status).toBe(201);
    expect(getSmsEntitlement).not.toHaveBeenCalled();
    expect(createCampaign).toHaveBeenCalled();
  });

  it("checks the emailCampaigns plan feature for an EMAIL channel campaign", async () => {
    await POST(campaignRequest({ channel: "EMAIL" }));
    expect(requirePlanFeature).toHaveBeenCalledWith("org-a", "emailCampaigns");
  });

  it("checks the emailCampaigns plan feature for an EMAIL_AND_SMS channel campaign", async () => {
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 990, limit: 1000 });
    await POST(campaignRequest({ channel: "EMAIL_AND_SMS" }));
    expect(requirePlanFeature).toHaveBeenCalledWith("org-a", "emailCampaigns");
  });

  it("never checks the emailCampaigns plan feature for a pure SMS campaign", async () => {
    getSmsEntitlement.mockResolvedValueOnce({ allowed: true, remaining: 990, limit: 1000 });
    await POST(campaignRequest({ channel: "SMS" }));
    expect(requirePlanFeature).not.toHaveBeenCalled();
  });

  it("rejects creating an EMAIL campaign with a standardized 403 when the organization lacks the emailCampaigns entitlement", async () => {
    const { PlanFeatureError } = await import("@/lib/plan-gate");
    requirePlanFeature.mockRejectedValueOnce(
      new PlanFeatureError("emailCampaigns", "This feature is not included in your Free plan. Upgrade to access it.")
    );

    const response = await POST(campaignRequest({ channel: "EMAIL" }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({ ok: false, code: "PLAN_FEATURE_REQUIRED", feature: "emailCampaigns" });
    expect(createCampaign).not.toHaveBeenCalled();
  });
});
