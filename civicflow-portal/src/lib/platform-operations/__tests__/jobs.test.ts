import { beforeEach, describe, expect, it, vi } from "vitest";

const smsMessageFindFirst = vi.fn();
const smsMessageCount = vi.fn();
const emailReminderLogFindFirst = vi.fn();
const emailReminderLogCount = vi.fn();
const reportExportFindFirst = vi.fn();
const reportExportCount = vi.fn();
const communicationCampaignFindFirst = vi.fn();
const communicationCampaignCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      findFirst: (...args: unknown[]) => smsMessageFindFirst(...args),
      count: (...args: unknown[]) => smsMessageCount(...args),
    },
    emailReminderLog: {
      findFirst: (...args: unknown[]) => emailReminderLogFindFirst(...args),
      count: (...args: unknown[]) => emailReminderLogCount(...args),
    },
    reportExport: {
      findFirst: (...args: unknown[]) => reportExportFindFirst(...args),
      count: (...args: unknown[]) => reportExportCount(...args),
    },
    communicationCampaign: {
      findFirst: (...args: unknown[]) => communicationCampaignFindFirst(...args),
      count: (...args: unknown[]) => communicationCampaignCount(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  smsMessageFindFirst.mockResolvedValue(null);
  smsMessageCount.mockResolvedValue(0);
  emailReminderLogFindFirst.mockResolvedValue(null);
  emailReminderLogCount.mockResolvedValue(0);
  reportExportFindFirst.mockResolvedValue(null);
  reportExportCount.mockResolvedValue(0);
  communicationCampaignFindFirst.mockResolvedValue(null);
  communicationCampaignCount.mockResolvedValue(0);
});

describe("listJobTypeSummaries", () => {
  it("reports 5 job types, with SMS Usage Notifications always unknown (no durable output table exists for it)", async () => {
    const { listJobTypeSummaries } = await import("../jobs");
    const summaries = await listJobTypeSummaries();
    expect(summaries).toHaveLength(5);
    const notifJob = summaries.find((s) => s.jobType === "SMS Usage Notifications");
    expect(notifJob?.status).toBe("unknown");
    expect(notifJob?.lastSuccessAt).toBeNull();
  });

  it("marks a job type healthy when it has zero recent failures", async () => {
    const { listJobTypeSummaries } = await import("../jobs");
    const summaries = await listJobTypeSummaries();
    const smsQueue = summaries.find((s) => s.jobType === "SMS Queue");
    expect(smsQueue?.status).toBe("healthy");
    expect(smsQueue?.recentFailureCount7d).toBe(0);
  });

  it("marks a job type degraded when it has recent failures", async () => {
    smsMessageCount.mockResolvedValueOnce(3); // SMS Queue's FAILED-in-7-days count
    const { listJobTypeSummaries } = await import("../jobs");
    const summaries = await listJobTypeSummaries();
    const smsQueue = summaries.find((s) => s.jobType === "SMS Queue");
    expect(smsQueue?.status).toBe("degraded");
    expect(smsQueue?.recentFailureCount7d).toBe(3);
  });
});

describe("getJobsHealthSummary", () => {
  it("sums failures across all tracked job types", async () => {
    smsMessageCount.mockResolvedValueOnce(2);
    reportExportCount.mockResolvedValueOnce(1);
    const { getJobsHealthSummary } = await import("../jobs");
    const summary = await getJobsHealthSummary();
    expect(summary.status).toBe("ok");
    if (summary.status === "ok") {
      expect(summary.value.recentFailureCount).toBe(3);
      expect(summary.value.jobTypesTracked).toBe(5);
      expect(summary.value.jobTypesUnknown).toBe(1);
    }
  });
});
