import { beforeEach, describe, expect, it, vi } from "vitest";

const subscriptionFindMany = vi.fn();
const organizationFindMany = vi.fn();
const organizationSmsSettingsFindMany = vi.fn();
const smsMessageCount = vi.fn();
const platformAccessFindMany = vi.fn();
const userCount = vi.fn();
const memberInviteCount = vi.fn();
const emailReminderLogCount = vi.fn();
const reportExportCount = vi.fn();
const reportExportFindFirst = vi.fn();
const communicationCampaignCount = vi.fn();
const communicationCampaignFindFirst = vi.fn();
const smsMessageFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findMany: (...args: unknown[]) => subscriptionFindMany(...args) },
    organization: { findMany: (...args: unknown[]) => organizationFindMany(...args) },
    organizationSmsSettings: { findMany: (...args: unknown[]) => organizationSmsSettingsFindMany(...args) },
    smsMessage: {
      count: (...args: unknown[]) => smsMessageCount(...args),
      findFirst: (...args: unknown[]) => smsMessageFindFirst(...args),
    },
    platformAccess: { findMany: (...args: unknown[]) => platformAccessFindMany(...args) },
    user: { count: (...args: unknown[]) => userCount(...args) },
    memberInvite: { count: (...args: unknown[]) => memberInviteCount(...args) },
    emailReminderLog: {
      count: (...args: unknown[]) => emailReminderLogCount(...args),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    reportExport: {
      count: (...args: unknown[]) => reportExportCount(...args),
      findFirst: (...args: unknown[]) => reportExportFindFirst(...args),
    },
    communicationCampaign: {
      count: (...args: unknown[]) => communicationCampaignCount(...args),
      findFirst: (...args: unknown[]) => communicationCampaignFindFirst(...args),
    },
  },
}));

function resetAllToEmpty() {
  subscriptionFindMany.mockResolvedValue([]);
  organizationFindMany.mockResolvedValue([]);
  organizationSmsSettingsFindMany.mockResolvedValue([]);
  smsMessageCount.mockResolvedValue(0);
  smsMessageFindFirst.mockResolvedValue(null);
  platformAccessFindMany.mockResolvedValue([]);
  userCount.mockResolvedValue(0);
  memberInviteCount.mockResolvedValue(0);
  emailReminderLogCount.mockResolvedValue(0);
  reportExportCount.mockResolvedValue(0);
  reportExportFindFirst.mockResolvedValue(null);
  communicationCampaignCount.mockResolvedValue(0);
  communicationCampaignFindFirst.mockResolvedValue(null);
}

describe("getOperationalRisks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllToEmpty();
  });

  it("returns an empty list when nothing is wrong", async () => {
    const { getOperationalRisks } = await import("../risks");
    expect(await getOperationalRisks()).toEqual([]);
  });

  it("surfaces a critical risk for a past-due subscription", async () => {
    subscriptionFindMany.mockResolvedValueOnce([
      { id: "sub-1", organizationId: "org-1", organization: { name: "Acme" }, updatedAt: new Date() },
    ]);
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id === "past-due:sub-1" && r.severity === "critical")).toBe(true);
  });

  it("surfaces a warning risk for an organization with no active owner", async () => {
    organizationFindMany.mockResolvedValueOnce([{ id: "org-2", name: "No Owner Org", memberships: [] }]);
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id === "no-owner:org-2" && r.severity === "warning")).toBe(true);
  });

  it("does not flag an organization that has an active owner", async () => {
    organizationFindMany.mockResolvedValueOnce([{ id: "org-3", name: "Fine Org", memberships: [{ id: "m1" }] }]);
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id.startsWith("no-owner:"))).toBe(false);
  });

  it("surfaces an info risk for a trial ending soon", async () => {
    organizationFindMany.mockImplementation((args: { where?: { trialEndsAt?: unknown } }) => {
      if (args?.where?.trialEndsAt) {
        return Promise.resolve([{ id: "org-4", name: "Trial Org", trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) }]);
      }
      return Promise.resolve([]);
    });
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id === "trial-ending:org-4" && r.severity === "info")).toBe(true);
  });

  it("surfaces a warning risk when SMS usage crosses 90% of the monthly limit", async () => {
    organizationSmsSettingsFindMany.mockResolvedValueOnce([
      { organizationId: "org-5", smsMonthlyLimit: 100, smsUsedThisPeriod: 95, organization: { name: "Heavy SMS Org" } },
    ]);
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id === "high-sms:org-5")).toBe(true);
  });

  it("does not flag SMS usage below the 90% threshold", async () => {
    organizationSmsSettingsFindMany.mockResolvedValueOnce([
      { organizationId: "org-6", smsMonthlyLimit: 100, smsUsedThisPeriod: 50, organization: { name: "Normal Org" } },
    ]);
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id.startsWith("high-sms:"))).toBe(false);
  });

  it("surfaces a critical SMS-failure-spike risk only when both volume and failure-rate thresholds are met", async () => {
    smsMessageCount.mockImplementation((args: { where?: { status?: string } }) => {
      if (args?.where?.status === "FAILED") return Promise.resolve(5);
      return Promise.resolve(20); // total
    });
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id === "sms-failure-spike" && r.severity === "critical")).toBe(true);
  });

  it("does not flag a failure spike when total volume is too low to be meaningful", async () => {
    smsMessageCount.mockImplementation((args: { where?: { status?: string } }) => {
      if (args?.where?.status === "FAILED") return Promise.resolve(3);
      return Promise.resolve(5); // total < 10 threshold
    });
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id === "sms-failure-spike")).toBe(false);
  });

  it("surfaces a warning risk for a platform administrator without MFA", async () => {
    platformAccessFindMany.mockResolvedValueOnce([{ userId: "u1", user: { email: "admin@example.com", mfaEnabled: false } }]);
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id === "platform-admin-no-mfa:u1")).toBe(true);
  });

  it("does not flag a platform administrator who has MFA enabled", async () => {
    platformAccessFindMany.mockResolvedValueOnce([{ userId: "u2", user: { email: "safe@example.com", mfaEnabled: true } }]);
    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();
    expect(risks.some((r) => r.id.startsWith("platform-admin-no-mfa:"))).toBe(false);
  });

  it("sorts risks with critical first, then warning, then info", async () => {
    subscriptionFindMany.mockResolvedValueOnce([{ id: "s1", organizationId: "o1", organization: { name: "A" }, updatedAt: new Date() }]);
    organizationFindMany.mockImplementation((args: { where?: { trialEndsAt?: unknown; status?: unknown } }) => {
      if (args?.where?.trialEndsAt) return Promise.resolve([{ id: "o2", name: "B", trialEndsAt: new Date(Date.now() + 1000) }]);
      if (args?.where?.status === "active") return Promise.resolve([{ id: "o3", name: "C", memberships: [] }]);
      return Promise.resolve([]);
    });

    const { getOperationalRisks } = await import("../risks");
    const risks = await getOperationalRisks();

    const severityOrder = risks.map((r) => r.severity);
    const rank = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < severityOrder.length; i++) {
      expect(rank[severityOrder[i]]).toBeGreaterThanOrEqual(rank[severityOrder[i - 1]]);
    }
  });
});
