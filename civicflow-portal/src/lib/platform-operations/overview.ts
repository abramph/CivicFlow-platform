import "server-only";
import { prisma } from "@/lib/prisma";
import { DEFAULT_REPORTING_WINDOW_DAYS, type Metric } from "./types";
import { estimateMrr } from "./billing";

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export interface OrganizationsOverview {
  total: number;
  active: number;
  trial: number;
  suspendedOrInactive: number;
  createdLast30Days: number;
}

export interface PeopleOverview {
  totalUsers: number;
  activeMemberships: number;
  pendingInvitations: number;
  multiOrgUsers: number;
  createdLast30Days: number;
}

export interface BillingOverview {
  active: number;
  trialing: number;
  pastDue: number;
  canceled: number;
  estimatedMrr: Metric<{ cents: number; subscriptionsCounted: number }>;
}

export interface CommunicationsOverview {
  windowDays: number;
  smsSent: Metric<number>;
  smsFailed: Metric<number>;
  whatsappSent: Metric<number>;
  whatsappFailed: Metric<number>;
  emailSent: Metric<number>;
  emailFailed: Metric<number>;
  pushSent: Metric<number>;
  smsOptOuts: Metric<number>;
}

export interface OperationsOverview {
  failedJobsLast7Days: Metric<number>;
}

export interface RecentActivityItem {
  id: string;
  kind: "audit" | "new_organization" | "subscription_change" | "communication_failure";
  label: string;
  detail: string;
  organizationId: string | null;
  occurredAt: string;
}

export interface PlatformOverview {
  organizations: OrganizationsOverview;
  people: PeopleOverview;
  billing: BillingOverview;
  communications: CommunicationsOverview;
  operations: OperationsOverview;
  recentActivity: RecentActivityItem[];
  generatedAt: string;
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const now = new Date();
  const windowStart = daysAgo(DEFAULT_REPORTING_WINDOW_DAYS);
  const asOf = now.toISOString();

  const [
    totalOrgs,
    activeOrgs,
    trialOrgs,
    suspendedOrInactiveOrgs,
    orgsCreatedRecently,
    totalUsers,
    activeMemberships,
    pendingInvitations,
    usersCreatedRecently,
    multiOrgUserRows,
    activeSubs,
    trialingSubs,
    pastDueSubs,
    canceledSubs,
    estimatedMrr,
    smsSent,
    smsFailed,
    whatsappSent,
    whatsappFailed,
    emailSent,
    emailFailed,
    pushSent,
    smsOptOuts,
    recentAuditEvents,
    recentOrgs,
    recentSubChanges,
    recentCommFailures,
    recentWhatsAppFailures,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.count({ where: { status: "active" } }),
    prisma.organization.count({ where: { subscriptions: { some: { status: "trialing" } } } }),
    prisma.organization.count({ where: { status: { in: ["suspended", "cancelled"] } } }),
    prisma.organization.count({ where: { createdAt: { gte: windowStart } } }),
    prisma.user.count(),
    prisma.organizationMembership.count({ where: { status: "active" } }),
    // MemberInvite has no `status` field — "pending" is derived: not yet
    // accepted, and not yet expired. This model is member-portal invites
    // (constituent → mobile login), not staff invites — this codebase has
    // no separate pending-invite state for staff OrganizationMembership
    // rows (invitedAt exists on the schema but is never written anywhere).
    prisma.memberInvite.count({ where: { acceptedAt: null, expiresAt: { gt: now } } }),
    prisma.user.count({ where: { createdAt: { gte: windowStart } } }),
    prisma.organizationMembership.groupBy({
      by: ["userId"],
      where: { status: "active" },
      _count: { _all: true },
    }),
    prisma.subscription.count({ where: { status: "active" } }),
    prisma.subscription.count({ where: { status: "trialing" } }),
    prisma.subscription.count({ where: { status: "past_due" } }),
    prisma.subscription.count({ where: { status: "cancelled" } }),
    estimateMrr(),
    prisma.smsMessage.count({ where: { createdAt: { gte: windowStart }, status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.smsMessage.count({ where: { createdAt: { gte: windowStart }, status: "FAILED" } }),
    prisma.whatsAppMessage.count({ where: { createdAt: { gte: windowStart }, status: { in: ["SENT", "DELIVERED", "READ"] } } }),
    prisma.whatsAppMessage.count({ where: { createdAt: { gte: windowStart }, status: { in: ["FAILED", "UNDELIVERED"] } } }),
    prisma.emailReminderLog.count({ where: { createdAt: { gte: windowStart }, status: "SENT" } }),
    prisma.emailReminderLog.count({ where: { createdAt: { gte: windowStart }, status: "FAILED" } }),
    prisma.communicationLog.count({ where: { createdAt: { gte: windowStart }, communicationType: "PUSH" } }),
    prisma.orgMember.count({ where: { smsOptedOutAt: { gte: windowStart } } }),
    prisma.auditEvent.findMany({
      where: { organizationId: null },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, action: true, actorEmail: true, createdAt: true, resource: true },
    }),
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, createdAt: true },
    }),
    prisma.subscription.findMany({
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, organizationId: true, status: true, plan: true, updatedAt: true },
    }),
    prisma.smsMessage.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, organizationId: true, errorMessage: true, createdAt: true },
    }),
    prisma.whatsAppMessage.findMany({
      where: { status: { in: ["FAILED", "UNDELIVERED"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, organizationId: true, errorMessage: true, createdAt: true },
    }),
  ]);

  const multiOrgUsers = multiOrgUserRows.filter((g) => g._count._all > 1).length;

  const recentActivity: RecentActivityItem[] = [
    ...recentAuditEvents.map((e) => ({
      id: `audit:${e.id}`,
      kind: "audit" as const,
      label: e.action,
      detail: e.actorEmail ?? "system",
      organizationId: null,
      occurredAt: e.createdAt.toISOString(),
    })),
    ...recentOrgs.map((o) => ({
      id: `org:${o.id}`,
      kind: "new_organization" as const,
      label: "New organization",
      detail: o.name,
      organizationId: o.id,
      occurredAt: o.createdAt.toISOString(),
    })),
    ...recentSubChanges.map((s) => ({
      id: `sub:${s.id}`,
      kind: "subscription_change" as const,
      label: `Subscription ${s.status}`,
      detail: s.plan,
      organizationId: s.organizationId,
      occurredAt: s.updatedAt.toISOString(),
    })),
    ...recentCommFailures.map((f) => ({
      id: `sms-fail:${f.id}`,
      kind: "communication_failure" as const,
      label: "SMS delivery failed",
      detail: f.errorMessage ?? "No error detail recorded",
      organizationId: f.organizationId,
      occurredAt: f.createdAt.toISOString(),
    })),
    ...recentWhatsAppFailures.map((f) => ({
      id: `whatsapp-fail:${f.id}`,
      kind: "communication_failure" as const,
      label: "WhatsApp delivery failed",
      detail: f.errorMessage ?? "No error detail recorded",
      organizationId: f.organizationId,
      occurredAt: f.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 15);

  return {
    organizations: {
      total: totalOrgs,
      active: activeOrgs,
      trial: trialOrgs,
      suspendedOrInactive: suspendedOrInactiveOrgs,
      createdLast30Days: orgsCreatedRecently,
    },
    people: {
      totalUsers,
      activeMemberships,
      pendingInvitations,
      multiOrgUsers,
      createdLast30Days: usersCreatedRecently,
    },
    billing: {
      active: activeSubs,
      trialing: trialingSubs,
      pastDue: pastDueSubs,
      canceled: canceledSubs,
      estimatedMrr,
    },
    communications: {
      windowDays: DEFAULT_REPORTING_WINDOW_DAYS,
      smsSent: { status: "ok", value: smsSent, source: "database", asOf },
      smsFailed: { status: "ok", value: smsFailed, source: "database", asOf },
      whatsappSent: { status: "ok", value: whatsappSent, source: "database", asOf },
      whatsappFailed: { status: "ok", value: whatsappFailed, source: "database", asOf },
      // EmailReminderLog only covers dues/contribution/renewal reminder
      // emails — auth emails (verification, password reset) are not
      // durably logged anywhere in this codebase. Labeled in the UI.
      emailSent: { status: "ok", value: emailSent, source: "database", asOf },
      emailFailed: { status: "ok", value: emailFailed, source: "database", asOf },
      // CommunicationLog only captures pushes sent via sendPushToMember();
      // it has no delivery-status field, so failures aren't queryable here.
      pushSent: { status: "ok", value: pushSent, source: "database", asOf },
      smsOptOuts: { status: "ok", value: smsOptOuts, source: "database", asOf },
    },
    operations: {
      // No durable job-run table exists yet (see lib/platform-operations/jobs.ts) —
      // deliberately left unavailable here rather than fabricated.
      failedJobsLast7Days: { status: "not_configured", reason: "No durable job-run table exists yet; see /admin/platform/jobs" },
    },
    recentActivity,
    generatedAt: asOf,
  };
}
