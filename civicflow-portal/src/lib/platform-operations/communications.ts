import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_REPORTING_WINDOW_DAYS, type Metric } from "./types";

function windowStart(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export interface SmsSummary {
  windowDays: number;
  orgsWithSmsEnabled: Metric<number>;
  sent: Metric<number>;
  delivered: Metric<number>;
  failed: Metric<number>;
  optOuts: Metric<number>;
  missingConsentSendAttempts: Metric<number>;
  usageByOrganization: Metric<{ organizationId: string; organizationName: string; sent: number; failed: number }[]>;
  recentProviderErrors: Metric<{ id: string; organizationId: string; errorMessage: string; occurredAt: string }[]>;
}

export interface EmailSummary {
  windowDays: number;
  /** EmailReminderLog only tracks dues/contribution/renewal reminder emails — NOT auth emails (verification, password reset), which are not durably logged anywhere in this codebase. */
  scope: "reminder_emails_only";
  sent: Metric<number>;
  failed: Metric<number>;
  recentErrors: Metric<{ id: string; organizationId: string; errorMessage: string; occurredAt: string }[]>;
  organizationsWithConfigProblems: Metric<{ organizationId: string; organizationName: string; failureCount: number }[]>;
}

export interface PushSummary {
  registeredTokens: Metric<number>;
  /** No delivery-receipt persistence exists for Expo pushes — "invalid tokens" are pruned silently on send, not counted anywhere. */
  invalidTokens: Metric<number>;
  /** Only pushes sent via sendPushToMember() are logged (CommunicationLog, type=PUSH) — any other push path isn't captured. */
  sentLast30Days: Metric<number>;
  usageByOrganization: Metric<{ organizationId: string; organizationName: string; count: number }[]>;
}

export interface CommunicationsOperationsSummary {
  sms: SmsSummary;
  email: EmailSummary;
  push: PushSummary;
}

export async function getCommunicationsOperationsSummary(
  windowDays = DEFAULT_REPORTING_WINDOW_DAYS
): Promise<CommunicationsOperationsSummary> {
  const start = windowStart(windowDays);
  const asOf = new Date().toISOString();

  const [
    orgsWithSmsEnabled,
    smsSent,
    smsDelivered,
    smsFailed,
    smsOptOuts,
    smsByOrgGroups,
    smsErrors,
    emailSent,
    emailFailed,
    emailErrors,
    emailFailuresByOrgGroups,
    registeredTokens,
    pushSentCount,
    pushByOrgGroups,
  ] = await Promise.all([
    prisma.organizationSmsSettings.count({ where: { smsAddOnActive: true } }),
    prisma.smsMessage.count({ where: { createdAt: { gte: start }, status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.smsMessage.count({ where: { createdAt: { gte: start }, status: "DELIVERED" } }),
    prisma.smsMessage.count({ where: { createdAt: { gte: start }, status: "FAILED" } }),
    prisma.orgMember.count({ where: { smsOptedOutAt: { gte: start } } }),
    prisma.smsMessage.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: start } },
      _count: { _all: true },
    }),
    prisma.smsMessage.findMany({
      where: { createdAt: { gte: start }, status: "FAILED", errorMessage: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, organizationId: true, errorMessage: true, createdAt: true },
    }),
    prisma.emailReminderLog.count({ where: { createdAt: { gte: start }, status: "SENT" } }),
    prisma.emailReminderLog.count({ where: { createdAt: { gte: start }, status: "FAILED" } }),
    prisma.emailReminderLog.findMany({
      where: { createdAt: { gte: start }, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, organizationId: true, errorMessage: true, createdAt: true },
    }),
    prisma.emailReminderLog.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: start }, status: "FAILED" },
      _count: { _all: true },
    }),
    prisma.mobileDeviceToken.count(),
    prisma.communicationLog.count({ where: { createdAt: { gte: start }, communicationType: "PUSH" } }),
    prisma.communicationLog.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: start }, communicationType: "PUSH" },
      _count: { _all: true },
    }),
  ]);

  const smsOrgIds = smsByOrgGroups.map((g) => g.organizationId);
  const pushOrgIds = pushByOrgGroups.map((g) => g.organizationId);
  const emailFailOrgIds = emailFailuresByOrgGroups.map((g) => g.organizationId);
  const orgNames = await prisma.organization.findMany({
    where: { id: { in: Array.from(new Set([...smsOrgIds, ...pushOrgIds, ...emailFailOrgIds])) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(orgNames.map((o) => [o.id, o.name]));

  // Per-org failed-count within the same window, for the usage-by-org breakdown.
  const smsFailedByOrgGroups = await prisma.smsMessage.groupBy({
    by: ["organizationId"],
    where: { createdAt: { gte: start }, status: "FAILED" },
    _count: { _all: true },
  });
  const failedByOrg = new Map(smsFailedByOrgGroups.map((g) => [g.organizationId, g._count._all]));

  return {
    sms: {
      windowDays,
      orgsWithSmsEnabled: { status: "ok", value: orgsWithSmsEnabled, source: "database", asOf },
      sent: { status: "ok", value: smsSent, source: "database", asOf },
      delivered: { status: "ok", value: smsDelivered, source: "database", asOf },
      failed: { status: "ok", value: smsFailed, source: "database", asOf },
      optOuts: { status: "ok", value: smsOptOuts, source: "database", asOf },
      // No separate "attempted send with missing consent" event is recorded
      // — sendSms() enforces consent before ever creating an SmsMessage row,
      // so a blocked attempt leaves no row to count.
      missingConsentSendAttempts: { status: "not_configured", reason: "Consent is enforced before an SmsMessage row is created; blocked attempts are not logged." },
      usageByOrganization: {
        status: "ok",
        value: smsByOrgGroups.map((g) => ({
          organizationId: g.organizationId,
          organizationName: nameById.get(g.organizationId) ?? "Unknown",
          sent: g._count._all,
          failed: failedByOrg.get(g.organizationId) ?? 0,
        })),
        source: "database",
        asOf,
      },
      recentProviderErrors: {
        status: "ok",
        value: smsErrors.map((e) => ({ id: e.id, organizationId: e.organizationId, errorMessage: e.errorMessage ?? "", occurredAt: e.createdAt.toISOString() })),
        source: "database",
        asOf,
      },
    },
    email: {
      windowDays,
      scope: "reminder_emails_only",
      sent: { status: "ok", value: emailSent, source: "database", asOf },
      failed: { status: "ok", value: emailFailed, source: "database", asOf },
      recentErrors: {
        status: "ok",
        value: emailErrors.map((e) => ({ id: e.id, organizationId: e.organizationId, errorMessage: e.errorMessage ?? "", occurredAt: e.createdAt.toISOString() })),
        source: "database",
        asOf,
      },
      organizationsWithConfigProblems: {
        status: "ok",
        value: emailFailuresByOrgGroups.map((g) => ({
          organizationId: g.organizationId,
          organizationName: nameById.get(g.organizationId) ?? "Unknown",
          failureCount: g._count._all,
        })),
        source: "database",
        asOf,
      },
    },
    push: {
      registeredTokens: { status: "ok", value: registeredTokens, source: "database", asOf },
      invalidTokens: { status: "not_configured", reason: "Stale tokens are pruned silently on send; no count is retained." },
      sentLast30Days: { status: "ok", value: pushSentCount, source: "database", asOf },
      usageByOrganization: {
        status: "ok",
        value: pushByOrgGroups.map((g) => ({
          organizationId: g.organizationId,
          organizationName: nameById.get(g.organizationId) ?? "Unknown",
          count: g._count._all,
        })),
        source: "database",
        asOf,
      },
    },
  };
}
