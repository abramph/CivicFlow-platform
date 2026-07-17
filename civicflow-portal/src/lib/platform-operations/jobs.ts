import "server-only";
import { prisma } from "@/lib/prisma";
import type { Metric } from "./types";

/**
 * There is no durable job-run table in this schema, and cron routes
 * (src/app/api/cron/*) don't write an AuditEvent for their own execution —
 * they're triggered externally (DO App Platform scheduled job + CRON_SECRET)
 * and just process work. Per the Operations Center spec's Phase 12 option 3
 * ("display scheduled-operation health derived from existing audit
 * infrastructure"), each job type below is inferred from the durable table
 * it actually writes to as a side effect — not a purpose-built job-run log.
 * A job type with no reliable output table is reported as "unknown" rather
 * than fabricated. Retry counts/correlation IDs are only shown where the
 * underlying table actually has that column.
 */

export type JobRunStatus = "healthy" | "degraded" | "unknown";

export interface JobTypeSummary {
  jobType: string;
  route: string;
  status: JobRunStatus;
  lastSuccessAt: string | null;
  recentFailureCount7d: number;
  notes: string;
}

const SEVEN_DAYS_AGO = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

async function smsQueueSummary(): Promise<JobTypeSummary> {
  const since = SEVEN_DAYS_AGO();
  const [lastSent, recentFailures] = await Promise.all([
    prisma.smsMessage.findFirst({
      where: { status: { in: ["SENT", "DELIVERED"] } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.smsMessage.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
  ]);
  return {
    jobType: "SMS Queue",
    route: "/api/cron/sms-queue",
    status: recentFailures > 0 ? "degraded" : "healthy",
    lastSuccessAt: lastSent?.sentAt?.toISOString() ?? null,
    recentFailureCount7d: recentFailures,
    notes: "Derived from SmsMessage rows this job writes; no separate job-run record exists.",
  };
}

async function remindersSummary(): Promise<JobTypeSummary> {
  const since = SEVEN_DAYS_AGO();
  const [lastSent, recentFailures] = await Promise.all([
    prisma.emailReminderLog.findFirst({
      where: { status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.emailReminderLog.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
  ]);
  return {
    jobType: "Reminders",
    route: "/api/cron/reminders",
    status: recentFailures > 0 ? "degraded" : "healthy",
    lastSuccessAt: lastSent?.sentAt?.toISOString() ?? null,
    recentFailureCount7d: recentFailures,
    notes: "Derived from EmailReminderLog rows this job writes; no separate job-run record exists.",
  };
}

async function reportsSummary(): Promise<JobTypeSummary> {
  const since = SEVEN_DAYS_AGO();
  const [lastCompleted, recentFailures] = await Promise.all([
    prisma.reportExport.findFirst({
      where: { status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    }),
    prisma.reportExport.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
  ]);
  return {
    jobType: "Report Exports",
    route: "/api/cron/reports",
    status: recentFailures > 0 ? "degraded" : "healthy",
    lastSuccessAt: lastCompleted?.completedAt?.toISOString() ?? null,
    recentFailureCount7d: recentFailures,
    notes: "Derived from ReportExport rows this job writes; no separate job-run record exists.",
  };
}

async function campaignsSummary(): Promise<JobTypeSummary> {
  const since = SEVEN_DAYS_AGO();
  const [lastSent, recentFailures] = await Promise.all([
    prisma.communicationCampaign.findFirst({
      where: { status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.communicationCampaign.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
  ]);
  return {
    jobType: "Communication Campaigns",
    route: "/api/cron/campaigns",
    status: recentFailures > 0 ? "degraded" : "healthy",
    lastSuccessAt: lastSent?.sentAt?.toISOString() ?? null,
    recentFailureCount7d: recentFailures,
    notes: "Derived from CommunicationCampaign rows this job writes; no separate job-run record exists.",
  };
}

function smsUsageNotificationsSummary(): JobTypeSummary {
  return {
    jobType: "SMS Usage Notifications",
    route: "/api/cron/sms-usage-notifications",
    status: "unknown",
    lastSuccessAt: null,
    recentFailureCount7d: 0,
    notes: "This job sends via sendEmail() directly, which is not durably logged anywhere (only structured console output) — no reliable signal exists.",
  };
}

export async function listJobTypeSummaries(): Promise<JobTypeSummary[]> {
  const [smsQueue, reminders, reports, campaigns] = await Promise.all([
    smsQueueSummary(),
    remindersSummary(),
    reportsSummary(),
    campaignsSummary(),
  ]);
  return [smsQueue, reminders, reports, campaigns, smsUsageNotificationsSummary()];
}

/** Lightweight rollup for the System Health page — avoids that page re-deriving the same five queries. */
export async function getJobsHealthSummary(): Promise<Metric<{ recentFailureCount: number; jobTypesTracked: number; jobTypesUnknown: number }>> {
  const summaries = await listJobTypeSummaries();
  const recentFailureCount = summaries.reduce((sum, s) => sum + s.recentFailureCount7d, 0);
  const jobTypesUnknown = summaries.filter((s) => s.status === "unknown").length;
  return {
    status: "ok",
    value: { recentFailureCount, jobTypesTracked: summaries.length, jobTypesUnknown },
    source: "derived",
    asOf: new Date().toISOString(),
  };
}
