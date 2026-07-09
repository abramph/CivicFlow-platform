import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyOrgSmsSettings = vi.fn();
const findUniqueOrganization = vi.fn();
const findManyOrgMembership = vi.fn();
const updateOrgSmsSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSmsSettings: {
      findMany: (...args: unknown[]) => findManyOrgSmsSettings(...args),
      update: (...args: unknown[]) => updateOrgSmsSettings(...args),
    },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
    organizationMembership: { findMany: (...args: unknown[]) => findManyOrgMembership(...args) },
  },
}));

const sendEmail = vi.fn().mockResolvedValue({ sent: true, skipped: false });
vi.mock("@/lib/mail", () => ({ sendEmail: (...args: unknown[]) => sendEmail(...args) }));

import { notifyOrgAdminsOfSmsUsageThresholds } from "@/lib/sms-usage-notifications";

describe("notifyOrgAdminsOfSmsUsageThresholds", () => {
  beforeEach(() => {
    findManyOrgSmsSettings.mockReset();
    findUniqueOrganization.mockReset();
    findUniqueOrganization.mockResolvedValue({ name: "Test Org" });
    findManyOrgMembership.mockReset();
    findManyOrgMembership.mockResolvedValue([{ user: { email: "owner@example.com" } }]);
    updateOrgSmsSettings.mockReset();
    sendEmail.mockClear();
  });

  it("does nothing when no org has crossed a new threshold", async () => {
    findManyOrgSmsSettings.mockResolvedValueOnce([
      { organizationId: "org-1", smsMonthlyLimit: 1000, smsUsedThisPeriod: 100, lastUsageThresholdNotified: 0 },
    ]);
    const result = await notifyOrgAdminsOfSmsUsageThresholds();
    expect(result.notified).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("notifies once when usage crosses 50% and updates lastUsageThresholdNotified", async () => {
    findManyOrgSmsSettings.mockResolvedValueOnce([
      { organizationId: "org-1", smsMonthlyLimit: 1000, smsUsedThisPeriod: 550, lastUsageThresholdNotified: 0 },
    ]);
    const result = await notifyOrgAdminsOfSmsUsageThresholds();

    expect(result.notified).toBe(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com", subject: expect.stringContaining("50%") })
    );
    expect(updateOrgSmsSettings).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      data: { lastUsageThresholdNotified: 50 },
    });
  });

  it("jumps straight to the highest crossed threshold instead of notifying every one in between", async () => {
    findManyOrgSmsSettings.mockResolvedValueOnce([
      { organizationId: "org-1", smsMonthlyLimit: 1000, smsUsedThisPeriod: 950, lastUsageThresholdNotified: 0 },
    ]);
    await notifyOrgAdminsOfSmsUsageThresholds();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringContaining("90%") }));
    expect(updateOrgSmsSettings).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      data: { lastUsageThresholdNotified: 90 },
    });
  });

  it("does not re-notify a threshold already recorded", async () => {
    findManyOrgSmsSettings.mockResolvedValueOnce([
      { organizationId: "org-1", smsMonthlyLimit: 1000, smsUsedThisPeriod: 600, lastUsageThresholdNotified: 50 },
    ]);
    const result = await notifyOrgAdminsOfSmsUsageThresholds();
    expect(result.notified).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("notifies every ORG_OWNER/ORG_ADMIN on the org", async () => {
    findManyOrgSmsSettings.mockResolvedValueOnce([
      { organizationId: "org-1", smsMonthlyLimit: 1000, smsUsedThisPeriod: 1100, lastUsageThresholdNotified: 0 },
    ]);
    findManyOrgMembership.mockResolvedValueOnce([
      { user: { email: "owner@example.com" } },
      { user: { email: "admin@example.com" } },
    ]);
    await notifyOrgAdminsOfSmsUsageThresholds();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
