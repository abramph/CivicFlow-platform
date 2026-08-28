import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findManyNotificationLogs = vi.fn();
const createNotificationLog = vi.fn();
const findManyHouseholds = vi.fn();
const findManyCharges = vi.fn();
const findManyProfiles = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaVolunteerNotificationLog: {
      findMany: (...a: unknown[]) => findManyNotificationLogs(...a),
      create: (...a: unknown[]) => createNotificationLog(...a),
    },
    ptaHousehold: { findMany: (...a: unknown[]) => findManyHouseholds(...a) },
    ptaVolunteerAssessmentCharge: { findMany: (...a: unknown[]) => findManyCharges(...a) },
    ptaProfile: { findMany: (...a: unknown[]) => findManyProfiles(...a) },
  },
}));

const sendEmail = vi.fn();
vi.mock("@/lib/mail", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEvent(...a) }));

const resolveOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({ resolveOrganizationAccess: (...a: unknown[]) => resolveOrganizationAccess(...a) }));

const requireVolunteerHoursFlag = vi.fn();
vi.mock("../guard", () => ({ requireVolunteerHoursFlag: (...a: unknown[]) => requireVolunteerHoursFlag(...a) }));

const getVolunteerRequirementPeriod = vi.fn();
const listVolunteerRequirementPeriods = vi.fn();
vi.mock("../periods", () => ({
  getVolunteerRequirementPeriod: (...a: unknown[]) => getVolunteerRequirementPeriod(...a),
  listVolunteerRequirementPeriods: (...a: unknown[]) => listVolunteerRequirementPeriods(...a),
}));

const listPricingWindows = vi.fn();
vi.mock("../pricing", () => ({ listPricingWindows: (...a: unknown[]) => listPricingWindows(...a) }));

const buildHouseholdReportContexts = vi.fn();
vi.mock("../reports/shared", () => ({ buildHouseholdReportContexts: (...a: unknown[]) => buildHouseholdReportContexts(...a) }));

const HOUSEHOLD = { id: "hh-1", primaryContact: { name: "Jane Smith", email: "jane@example.com" } };
const NOT_MET_CONTEXT = {
  householdId: "hh-1",
  householdDisplayName: "The Smiths",
  householdStatus: "ACTIVE",
  requirement: { requiredMinutes: 600, assignmentType: "STANDARD", matchedScopeType: null, assignmentId: null, reason: null, exempt: false },
  totals: {} as Record<string, number>,
  remainingMinutes: 300,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
  requireVolunteerHoursFlag.mockResolvedValue({});
  resolveOrganizationAccess.mockResolvedValue({ allowed: true });
  findManyNotificationLogs.mockResolvedValue([]);
  createNotificationLog.mockResolvedValue({ id: "log-1" });
  findManyHouseholds.mockResolvedValue([HOUSEHOLD]);
  sendEmail.mockResolvedValue({ sent: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sendVolunteerHoursDeadlineReminders", () => {
  const activePeriod = {
    id: "period-1",
    name: "2026-2027 School Year",
    status: "ACTIVE" as const,
    volunteerDeadline: new Date("2027-01-10T00:00:00Z"),
  };

  it("does nothing when the notifications flag is off", async () => {
    requireVolunteerHoursFlag.mockRejectedValue(new Error("disabled"));
    const { sendVolunteerHoursDeadlineReminders } = await import("../notifications");
    const result = await sendVolunteerHoursDeadlineReminders("org-1", "period-1");
    expect(result).toEqual({ organizationId: "org-1", sent: 0, skippedNoContact: 0, failed: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does nothing when billing access is not allowed", async () => {
    resolveOrganizationAccess.mockResolvedValue({ allowed: false });
    getVolunteerRequirementPeriod.mockResolvedValue(activePeriod);
    const { sendVolunteerHoursDeadlineReminders } = await import("../notifications");
    await sendVolunteerHoursDeadlineReminders("org-1", "period-1");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does nothing when the deadline is outside the lookahead window", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ ...activePeriod, volunteerDeadline: new Date("2027-06-01T00:00:00Z") });
    const { sendVolunteerHoursDeadlineReminders } = await import("../notifications");
    await sendVolunteerHoursDeadlineReminders("org-1", "period-1", { lookaheadDays: 14 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("emails only households with hours remaining and not exempt, and logs a dedup row", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue(activePeriod);
    buildHouseholdReportContexts.mockResolvedValue([
      NOT_MET_CONTEXT,
      { ...NOT_MET_CONTEXT, householdId: "hh-2", remainingMinutes: 0 },
      { ...NOT_MET_CONTEXT, householdId: "hh-3", requirement: { ...NOT_MET_CONTEXT.requirement, exempt: true } },
    ]);
    const { sendVolunteerHoursDeadlineReminders } = await import("../notifications");
    const result = await sendVolunteerHoursDeadlineReminders("org-1", "period-1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "jane@example.com" }));
    expect(createNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notificationType: "DEADLINE_REMINDER", householdId: "hh-1", sourceId: "period-1" }) })
    );
    expect(result.sent).toBe(1);
  });

  it("skips a household that has no primary-contact email on file", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue(activePeriod);
    buildHouseholdReportContexts.mockResolvedValue([NOT_MET_CONTEXT]);
    findManyHouseholds.mockResolvedValue([{ id: "hh-1", primaryContact: null }]);
    const { sendVolunteerHoursDeadlineReminders } = await import("../notifications");
    const result = await sendVolunteerHoursDeadlineReminders("org-1", "period-1");
    expect(result.skippedNoContact).toBe(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never re-notifies a household already logged for this period", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue(activePeriod);
    buildHouseholdReportContexts.mockResolvedValue([NOT_MET_CONTEXT]);
    findManyNotificationLogs.mockResolvedValue([{ householdId: "hh-1" }]);
    const { sendVolunteerHoursDeadlineReminders } = await import("../notifications");
    const result = await sendVolunteerHoursDeadlineReminders("org-1", "period-1");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });
});

describe("sendVolunteerHoursAssessmentPostedNotices", () => {
  it("emails each newly posted charge's household once and dedupes by chargeId", async () => {
    findManyCharges.mockResolvedValue([
      { id: "charge-1", requirementPeriodId: "period-1", householdId: "hh-1", amountCents: 9000, dueDate: new Date("2027-02-01") },
    ]);
    const { sendVolunteerHoursAssessmentPostedNotices } = await import("../notifications");
    const result = await sendVolunteerHoursAssessmentPostedNotices("org-1", "batch-1");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(createNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notificationType: "ASSESSMENT_POSTED", sourceId: "charge-1" }) })
    );
    expect(result.sent).toBe(1);
  });

  it("does not re-send for a charge already logged", async () => {
    findManyCharges.mockResolvedValue([{ id: "charge-1", requirementPeriodId: "period-1", householdId: "hh-1", amountCents: 9000, dueDate: null }]);
    findManyNotificationLogs.mockResolvedValue([{ sourceId: "charge-1" }]);
    const { sendVolunteerHoursAssessmentPostedNotices } = await import("../notifications");
    const result = await sendVolunteerHoursAssessmentPostedNotices("org-1", "batch-1");
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("does nothing when the notifications flag is off", async () => {
    requireVolunteerHoursFlag.mockRejectedValue(new Error("disabled"));
    findManyCharges.mockResolvedValue([{ id: "charge-1", requirementPeriodId: "period-1", householdId: "hh-1", amountCents: 9000, dueDate: null }]);
    const { sendVolunteerHoursAssessmentPostedNotices } = await import("../notifications");
    await sendVolunteerHoursAssessmentPostedNotices("org-1", "batch-1");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("sendVolunteerHoursRateChangeNotices", () => {
  const activePeriod = { id: "period-1", name: "2026-2027 School Year", status: "ACTIVE" as const };

  it("emails not-yet-fulfilled households once per upcoming pricing window", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue(activePeriod);
    listPricingWindows.mockResolvedValue([
      { id: "window-1", name: "Spring rate", active: true, startAt: new Date("2027-01-05T00:00:00Z"), endAt: new Date("2027-06-01") },
      { id: "window-2", name: "Too far out", active: true, startAt: new Date("2027-12-01T00:00:00Z"), endAt: new Date("2028-01-01") },
    ]);
    buildHouseholdReportContexts.mockResolvedValue([NOT_MET_CONTEXT]);
    const { sendVolunteerHoursRateChangeNotices } = await import("../notifications");
    const result = await sendVolunteerHoursRateChangeNotices("org-1", "period-1", { lookaheadDays: 7 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(createNotificationLog).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notificationType: "RATE_CHANGE_UPCOMING", pricingWindowId: "window-1" }) })
    );
    expect(result.sent).toBe(1);
  });

  it("never sends when the buyout capability is unavailable", async () => {
    requireVolunteerHoursFlag.mockImplementation((_org: string, capability: string) => (capability === "buyout" ? Promise.reject(new Error("off")) : Promise.resolve({})));
    const { sendVolunteerHoursRateChangeNotices } = await import("../notifications");
    await sendVolunteerHoursRateChangeNotices("org-1", "period-1");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("previewVolunteerHoursNotification", () => {
  it("sends a clearly-marked test email to the supplied recipient and audits it", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1", name: "2026-2027 School Year" });
    const { previewVolunteerHoursNotification } = await import("../notifications");
    await previewVolunteerHoursNotification("org-1", "period-1", "DEADLINE_REMINDER", "officer@example.com", {
      userId: "user-1",
      userEmail: "officer@example.com",
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "officer@example.com", subject: expect.stringContaining("[TEST]") }));
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.volunteer_hours.notification_previewed" }));
  });

  it("works even when the notifications flag is off — only the base requirements flag is checked", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1", name: "2026-2027 School Year" });
    const { previewVolunteerHoursNotification } = await import("../notifications");
    await previewVolunteerHoursNotification("org-1", "period-1", "ASSESSMENT_POSTED", "officer@example.com", {
      userId: "user-1",
      userEmail: "officer@example.com",
    });
    expect(requireVolunteerHoursFlag).toHaveBeenCalledWith("org-1", "requirements");
    expect(sendEmail).toHaveBeenCalled();
  });

  it("rejects a blank test recipient", async () => {
    getVolunteerRequirementPeriod.mockResolvedValue({ id: "period-1", name: "2026-2027 School Year" });
    const { previewVolunteerHoursNotification } = await import("../notifications");
    await expect(
      previewVolunteerHoursNotification("org-1", "period-1", "DEADLINE_REMINDER", "  ", { userId: "user-1", userEmail: "officer@example.com" })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });
});

describe("sendVolunteerHoursNotificationsAllOrganizations", () => {
  const ORIGINAL_ENV = { ...process.env };

  // These tests exercise the REAL isPtaVolunteerHoursPlatformEnabled() (from
  // @/lib/env, not mocked in this file) against every raw env-var value the
  // parser must handle, so resetModules + a fresh dynamic import is required
  // per test — getServerEnv() caches its parsed result at module scope, so
  // without resetting the module registry a later process.env mutation
  // would silently be ignored (see env-pta-volunteer-hours-flag.test.ts for
  // the same pattern used to test the parser directly).
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function runSweep() {
    const { sendVolunteerHoursNotificationsAllOrganizations } = await import("../notifications");
    return sendVolunteerHoursNotificationsAllOrganizations();
  }

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["'false'", "false"],
    ["'0'", "0"],
    ["unexpected value", "yes"],
  ])("platform variable %s: returns immediately without querying any organization", async (_label, value) => {
    if (value === undefined) delete process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED;
    else process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = value;

    const result = await runSweep();

    expect(findManyProfiles).not.toHaveBeenCalled();
    expect(listVolunteerRequirementPeriods).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ organizationsProcessed: 0, totalSent: 0 });
  });

  it.each([["'true'", "true"], ["'1'", "1"]])(
    "platform variable %s: still requires each organization's own notifications+requirements flags",
    async (_label, value) => {
      process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = value;
      findManyProfiles.mockResolvedValue([{ organizationId: "org-1" }]);
      listVolunteerRequirementPeriods.mockResolvedValue([
        { id: "period-1", status: "ACTIVE", volunteerDeadline: new Date("2027-01-10T00:00:00Z") },
        { id: "period-2", status: "CLOSED", volunteerDeadline: null },
      ]);
      getVolunteerRequirementPeriod.mockResolvedValue({
        id: "period-1",
        name: "2026-2027",
        status: "ACTIVE",
        volunteerDeadline: new Date("2027-01-10T00:00:00Z"),
      });
      listPricingWindows.mockResolvedValue([]);
      buildHouseholdReportContexts.mockResolvedValue([]);

      const result = await runSweep();

      expect(findManyProfiles).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ptaVolunteerNotificationsEnabled: true, ptaVolunteerRequirementsEnabled: true } })
      );
      expect(result.organizationsProcessed).toBe(1);
    }
  );

  it("platform enabled but no organization matches the notifications+requirements flag combination: no notifications", async () => {
    process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = "true";
    findManyProfiles.mockResolvedValue([]); // simulates zero rows matching ptaVolunteerNotificationsEnabled: true

    const result = await runSweep();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result).toEqual({ organizationsProcessed: 0, totalSent: 0 });
  });

  it("platform enabled but the org's requirements flag is off: no notifications", async () => {
    process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = "true";
    findManyProfiles.mockResolvedValue([]); // requirements:false is part of the same where-filter, so it's excluded the same way

    const result = await runSweep();

    expect(sendEmail).not.toHaveBeenCalled();
    expect(result.totalSent).toBe(0);
  });

  it("repeated sweep does not send a duplicate notification for the same household/period", async () => {
    process.env.PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED = "1";
    findManyProfiles.mockResolvedValue([{ organizationId: "org-1" }]);
    listVolunteerRequirementPeriods.mockResolvedValue([
      { id: "period-1", status: "ACTIVE", volunteerDeadline: new Date("2027-01-10T00:00:00Z") },
    ]);
    getVolunteerRequirementPeriod.mockResolvedValue({
      id: "period-1",
      name: "2026-2027",
      status: "ACTIVE",
      volunteerDeadline: new Date("2027-01-10T00:00:00Z"),
    });
    listPricingWindows.mockResolvedValue([]);
    buildHouseholdReportContexts.mockResolvedValue([NOT_MET_CONTEXT]);
    findManyHouseholds.mockResolvedValue([HOUSEHOLD]);

    // First sweep: nothing logged yet, so it sends and logs.
    findManyNotificationLogs.mockResolvedValueOnce([]);
    const first = await runSweep();
    expect(first.totalSent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // Second sweep (module cache reset again, same as a real repeated cron
    // invocation): the dedup row from the first send now exists.
    vi.resetModules();
    findManyNotificationLogs.mockResolvedValue([{ householdId: "hh-1" }]);
    const second = await runSweep();
    expect(second.totalSent).toBe(0);
    expect(sendEmail).toHaveBeenCalledTimes(1); // still just the one call from the first sweep
  });
});
