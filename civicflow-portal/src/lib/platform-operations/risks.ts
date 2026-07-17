import "server-only";
import { prisma } from "@/lib/prisma";
import type { OperationalRisk } from "./types";
import { listJobTypeSummaries } from "./jobs";

/**
 * Deterministic, rule-based only — no AI/ML scoring, per the Operations
 * Center spec. Deliberately does NOT call getSystemHealth() (live Stripe/DB
 * timeout checks) — that would make every Overview page load pay for a
 * round trip to every external provider. Provider-outage risk is visible on
 * the dedicated System Health page instead; this module covers everything
 * derivable from local data alone, cheaply.
 */

const SEVEN_DAYS_AGO = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const TWENTY_FOUR_HOURS_AGO = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
const FOURTEEN_DAYS_FROM_NOW = () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

async function pastDueSubscriptionRisks(): Promise<OperationalRisk[]> {
  const rows = await prisma.subscription.findMany({
    where: { status: "past_due" },
    select: { id: true, organizationId: true, organization: { select: { name: true } }, updatedAt: true },
    take: 50,
  });
  return rows.map((r) => ({
    id: `past-due:${r.id}`,
    severity: "critical",
    title: "Past-due subscription",
    explanation: `${r.organization.name}'s subscription is past due.`,
    affectedEntity: { type: "organization", id: r.organizationId, label: r.organization.name },
    firstDetectedAt: r.updatedAt.toISOString(),
    href: `/admin/platform/organizations/${r.organizationId}`,
    source: "database",
  }));
}

async function noActiveOwnerRisks(): Promise<OperationalRisk[]> {
  const orgs = await prisma.organization.findMany({
    where: { status: "active" },
    select: {
      id: true,
      name: true,
      memberships: { where: { status: "active", role: { in: ["ORG_OWNER", "SUPER_ADMIN"] } }, select: { id: true } },
    },
    take: 500,
  });
  return orgs
    .filter((o) => o.memberships.length === 0)
    .map((o) => ({
      id: `no-owner:${o.id}`,
      severity: "warning" as const,
      title: "Organization has no active owner",
      explanation: `${o.name} has zero active ORG_OWNER memberships.`,
      affectedEntity: { type: "organization", id: o.id, label: o.name },
      firstDetectedAt: null,
      href: `/admin/platform/organizations/${o.id}`,
      source: "database" as const,
    }));
}

async function trialsEndingSoonRisks(): Promise<OperationalRisk[]> {
  const orgs = await prisma.organization.findMany({
    where: { trialEndsAt: { gte: new Date(), lte: FOURTEEN_DAYS_FROM_NOW() } },
    select: { id: true, name: true, trialEndsAt: true },
    take: 50,
  });
  return orgs.map((o) => ({
    id: `trial-ending:${o.id}`,
    severity: "info",
    title: "Trial ending soon",
    explanation: `${o.name}'s trial ends ${o.trialEndsAt!.toISOString().slice(0, 10)}.`,
    affectedEntity: { type: "organization", id: o.id, label: o.name },
    firstDetectedAt: null,
    href: `/admin/platform/organizations/${o.id}`,
    source: "database",
  }));
}

async function missingBillingLinkageRisks(): Promise<OperationalRisk[]> {
  const orgs = await prisma.organization.findMany({
    where: { plan: { in: ["essential", "elite"] }, subscriptions: { none: {} } },
    select: { id: true, name: true, plan: true },
    take: 50,
  });
  return orgs.map((o) => ({
    id: `missing-billing:${o.id}`,
    severity: "warning",
    title: "Paid plan with no subscription record",
    explanation: `${o.name} is on the ${o.plan} plan but has no Subscription row at all.`,
    affectedEntity: { type: "organization", id: o.id, label: o.name },
    firstDetectedAt: null,
    href: `/admin/platform/organizations/${o.id}`,
    source: "database",
  }));
}

async function highSmsUsageRisks(): Promise<OperationalRisk[]> {
  const rows = await prisma.organizationSmsSettings.findMany({
    where: { smsAddOnActive: true, smsMonthlyLimit: { gt: 0 } },
    select: { organizationId: true, smsMonthlyLimit: true, smsUsedThisPeriod: true, organization: { select: { name: true } } },
    take: 500,
  });
  return rows
    .filter((r) => r.smsUsedThisPeriod / r.smsMonthlyLimit >= 0.9)
    .map((r) => ({
      id: `high-sms:${r.organizationId}`,
      severity: "warning" as const,
      title: "Approaching SMS usage limit",
      explanation: `${r.organization.name} has used ${r.smsUsedThisPeriod}/${r.smsMonthlyLimit} messages this billing period (${Math.round((r.smsUsedThisPeriod / r.smsMonthlyLimit) * 100)}%).`,
      affectedEntity: { type: "organization", id: r.organizationId, label: r.organization.name },
      firstDetectedAt: null,
      href: `/admin/platform/organizations/${r.organizationId}`,
      source: "database" as const,
    }));
}

async function communicationFailureSpikeRisk(): Promise<OperationalRisk[]> {
  const since = TWENTY_FOUR_HOURS_AGO();
  const [sent, failed] = await Promise.all([
    prisma.smsMessage.count({ where: { createdAt: { gte: since } } }),
    prisma.smsMessage.count({ where: { createdAt: { gte: since }, status: "FAILED" } }),
  ]);
  if (sent < 10 || failed / sent < 0.2) return [];
  return [
    {
      id: "sms-failure-spike",
      severity: "critical",
      title: "SMS failure rate spike",
      explanation: `${failed} of ${sent} SMS sends failed in the last 24 hours (${Math.round((failed / sent) * 100)}%).`,
      affectedEntity: null,
      firstDetectedAt: null,
      href: "/admin/platform/communications",
      source: "database",
    },
  ];
}

async function repeatedJobFailureRisks(): Promise<OperationalRisk[]> {
  const summaries = await listJobTypeSummaries();
  return summaries
    .filter((s) => s.recentFailureCount7d > 0)
    .map((s) => ({
      id: `job-failures:${s.jobType}`,
      severity: s.recentFailureCount7d >= 5 ? ("critical" as const) : ("warning" as const),
      title: `${s.jobType} has recent failures`,
      explanation: `${s.recentFailureCount7d} failure(s) in the last 7 days.`,
      affectedEntity: null,
      firstDetectedAt: null,
      href: "/admin/platform/jobs",
      source: "derived" as const,
    }));
}

async function platformAdminWithoutMfaRisks(): Promise<OperationalRisk[]> {
  const grants = await prisma.platformAccess.findMany({
    where: { status: "ACTIVE" },
    select: { userId: true, user: { select: { email: true, mfaEnabled: true } } },
  });
  return grants
    .filter((g) => !g.user.mfaEnabled)
    .map((g) => ({
      id: `platform-admin-no-mfa:${g.userId}`,
      severity: "warning" as const,
      title: "Platform administrator without MFA",
      explanation: `${g.user.email} holds an active PlatformAccess grant with MFA disabled.`,
      affectedEntity: { type: "user", id: g.userId, label: g.user.email },
      firstDetectedAt: null,
      href: "/admin/platform/people",
      source: "database" as const,
    }));
}

async function orphanedUsersRisk(): Promise<OperationalRisk[]> {
  const count = await prisma.user.count({
    where: { memberships: { none: { status: "active" } }, platformAccess: { none: { status: "ACTIVE" } } },
  });
  if (count === 0) return [];
  return [
    {
      id: "orphaned-users",
      severity: "info",
      title: "Users with no active membership or platform access",
      explanation: `${count} user account(s) have zero active organization memberships and zero platform access.`,
      affectedEntity: null,
      firstDetectedAt: null,
      href: "/admin/platform/people",
      source: "database",
    },
  ];
}

async function stalePendingInvitationsRisk(): Promise<OperationalRisk[]> {
  const count = await prisma.memberInvite.count({
    where: { acceptedAt: null, expiresAt: { gt: new Date() }, createdAt: { lt: SEVEN_DAYS_AGO() } },
  });
  if (count === 0) return [];
  return [
    {
      id: "stale-invitations",
      severity: "info",
      title: "Pending invitations older than 7 days",
      explanation: `${count} member invitation(s) have been pending for more than 7 days without being accepted.`,
      affectedEntity: null,
      firstDetectedAt: null,
      href: "/admin/platform/organizations",
      source: "database",
    },
  ];
}

export async function getOperationalRisks(): Promise<OperationalRisk[]> {
  const groups = await Promise.all([
    pastDueSubscriptionRisks(),
    noActiveOwnerRisks(),
    trialsEndingSoonRisks(),
    missingBillingLinkageRisks(),
    highSmsUsageRisks(),
    communicationFailureSpikeRisk(),
    repeatedJobFailureRisks(),
    platformAdminWithoutMfaRisks(),
    orphanedUsersRisk(),
    stalePendingInvitationsRisk(),
  ]);

  const severityRank: Record<OperationalRisk["severity"], number> = { critical: 0, warning: 1, info: 2 };
  return groups.flat().sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
