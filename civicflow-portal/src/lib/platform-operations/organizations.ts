import "server-only";
import type { OrganizationVertical, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import {
  normalizePagination,
  paginationResult,
  type PagedResult,
  type PaginationInput,
} from "./types";

export type OrgHealthStatus = "healthy" | "attention" | "critical";

/** Deterministic, no-AI health rule shared with risks.ts so the directory badge and the risk feed never disagree. */
export function deriveOrganizationHealth(input: {
  status: string;
  latestSubscriptionStatus: string | null;
  activeOwnerCount: number;
}): OrgHealthStatus {
  if (input.status === "suspended" || input.status === "cancelled") return "critical";
  if (input.latestSubscriptionStatus === "past_due") return "critical";
  if (input.activeOwnerCount === 0) return "attention";
  if (input.latestSubscriptionStatus === "unpaid") return "attention";
  return "healthy";
}

export interface OrganizationListFilters {
  search?: string;
  status?: string;
  plan?: string;
  organizationType?: string;
  primaryVertical?: OrganizationVertical;
  createdAfter?: Date;
  createdBefore?: Date;
  subscriptionStatus?: string;
}

export type OrganizationSortField = "name" | "createdAt" | "plan" | "status";

export interface OrganizationListItem {
  id: string;
  name: string;
  slug: string;
  organizationType: string | null;
  primaryVertical: OrganizationVertical;
  plan: string;
  status: string;
  createdAt: string;
  activeMemberCount: number;
  latestSubscriptionStatus: string | null;
  smsAddOnActive: boolean;
  lastActivityAt: string | null;
  health: OrgHealthStatus;
  /** Internal/platform-owned organization exempt from tenant billing (see Organization.billingExempt) — never inferred, only ever this stored column. */
  billingExempt: boolean;
}

function buildWhere(filters: OrganizationListFilters): Prisma.OrganizationWhereInput {
  const where: Prisma.OrganizationWhereInput = {};

  if (filters.search?.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } },
      { id: term },
    ];
  }
  if (filters.status) where.status = filters.status as Prisma.EnumOrgStatusFilter["equals"];
  if (filters.plan) where.plan = filters.plan;
  if (filters.organizationType) where.organizationType = filters.organizationType;
  if (filters.primaryVertical) where.primaryVertical = filters.primaryVertical;
  if (filters.createdAfter || filters.createdBefore) {
    where.createdAt = {
      ...(filters.createdAfter ? { gte: filters.createdAfter } : {}),
      ...(filters.createdBefore ? { lte: filters.createdBefore } : {}),
    };
  }
  if (filters.subscriptionStatus) {
    where.subscriptions = { some: { status: filters.subscriptionStatus as Prisma.EnumSubscriptionStatusFilter["equals"] } };
  }

  return where;
}

export async function listOrganizations(
  filters: OrganizationListFilters,
  pagination: PaginationInput,
  sort: { field: OrganizationSortField; direction: "asc" | "desc" } = { field: "createdAt", direction: "desc" }
): Promise<PagedResult<OrganizationListItem>> {
  const { page, pageSize } = normalizePagination(pagination);
  const where = buildWhere(filters);

  const [totalCount, rows] = await Promise.all([
    prisma.organization.count({ where }),
    prisma.organization.findMany({
      where,
      orderBy: { [sort.field]: sort.direction },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        organizationType: true,
        primaryVertical: true,
        plan: true,
        status: true,
        createdAt: true,
        billingExempt: true,
        _count: { select: { memberships: true } },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
        smsSettings: { select: { smsAddOnActive: true } },
      },
    }),
  ]);

  const orgIds = rows.map((r) => r.id);
  const [activeOwnerCounts, lastActivity] = await Promise.all([
    prisma.organizationMembership.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds }, role: { in: ["ORG_OWNER", "SUPER_ADMIN"] }, status: "active" },
      _count: { _all: true },
    }),
    prisma.auditEvent.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgIds } },
      _max: { createdAt: true },
    }),
  ]);

  const ownerCountByOrg = new Map(activeOwnerCounts.map((r) => [r.organizationId, r._count._all]));
  const lastActivityByOrg = new Map(lastActivity.map((r) => [r.organizationId, r._max.createdAt]));

  const items: OrganizationListItem[] = rows.map((org) => {
    const latestSubscriptionStatus = org.subscriptions[0]?.status ?? null;
    const activeOwnerCount = ownerCountByOrg.get(org.id) ?? 0;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      organizationType: org.organizationType,
      primaryVertical: org.primaryVertical,
      plan: org.plan,
      status: org.status,
      createdAt: org.createdAt.toISOString(),
      activeMemberCount: org._count.memberships,
      latestSubscriptionStatus,
      smsAddOnActive: org.smsSettings?.smsAddOnActive ?? false,
      lastActivityAt: lastActivityByOrg.get(org.id)?.toISOString() ?? null,
      health: deriveOrganizationHealth({ status: org.status, latestSubscriptionStatus, activeOwnerCount }),
      billingExempt: org.billingExempt,
    };
  });

  return { items, pagination: paginationResult({ page, pageSize }, totalCount) };
}

export interface OrganizationDetail {
  identity: {
    id: string;
    name: string;
    slug: string;
    organizationType: string | null;
    primaryVertical: OrganizationVertical;
    status: string;
    plan: string;
    createdAt: string;
    ownerSummary: { userId: string; email: string; displayName: string | null } | null;
    /** Internal/platform-owned organization exempt from tenant billing (see Organization.billingExempt). */
    billingExempt: boolean;
  };
  membership: {
    totalActive: number;
    roleDistribution: Record<string, number>;
    pendingInvitations: number;
    deactivated: number;
    multiOrgMemberCount: number;
  };
  billing: {
    stripeCustomerId: string | null;
    latestSubscription: {
      status: string;
      plan: string;
      currentPeriodEnd: string | null;
      trialEndsAt: string | null;
      cancelAtPeriodEnd: boolean;
    } | null;
  };
  communications: {
    smsAddOnActive: boolean;
    smsConsentCount: number;
    smsSentLast30Days: number;
    smsFailedLast30Days: number;
  };
  operationalHealth: {
    health: OrgHealthStatus;
    recentAuditEvents: { id: string; action: string; actorEmail: string | null; createdAt: string }[];
  };
}

export async function getOrganizationDetail(organizationId: string): Promise<OrganizationDetail | null> {
  const windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      organizationType: true,
      primaryVertical: true,
      status: true,
      plan: true,
      createdAt: true,
      trialEndsAt: true,
      billingExempt: true,
    },
  });
  if (!org) return null;

  const [
    memberships,
    pendingInvitations,
    deactivatedCount,
    latestSubscription,
    smsSettings,
    smsConsentCount,
    smsSentLast30Days,
    smsFailedLast30Days,
    recentAuditEvents,
    ownerMembership,
  ] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: { organizationId, status: "active" },
      select: { role: true, userId: true },
    }),
    prisma.memberInvite.count({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
    }),
    prisma.organizationMembership.count({ where: { organizationId, status: "suspended" } }),
    prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { status: true, plan: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, stripeCustomerId: true },
    }),
    prisma.organizationSmsSettings.findUnique({ where: { organizationId }, select: { smsAddOnActive: true } }),
    prisma.orgMember.count({ where: { organizationId, smsOptIn: true } }),
    prisma.smsMessage.count({ where: { organizationId, createdAt: { gte: windowStart }, status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.smsMessage.count({ where: { organizationId, createdAt: { gte: windowStart }, status: "FAILED" } }),
    prisma.auditEvent.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, actorEmail: true, createdAt: true },
    }),
    prisma.organizationMembership.findFirst({
      where: { organizationId, status: "active", role: { in: ["ORG_OWNER", "SUPER_ADMIN"] } },
      orderBy: { joinedAt: "asc" },
      select: { user: { select: { id: true, email: true, displayName: true } } },
    }),
  ]);

  const roleDistribution: Record<string, number> = {};
  for (const m of memberships) {
    roleDistribution[m.role] = (roleDistribution[m.role] ?? 0) + 1;
  }

  const memberUserIds = memberships.map((m) => m.userId);
  const multiOrgGroups =
    memberUserIds.length > 0
      ? await prisma.organizationMembership.groupBy({
          by: ["userId"],
          where: { userId: { in: memberUserIds }, status: "active" },
          _count: { _all: true },
        })
      : [];
  const multiOrgMemberCount = multiOrgGroups.filter((g) => g._count._all > 1).length;

  const activeOwnerCount = memberships.filter((m) => m.role === "ORG_OWNER" || m.role === "SUPER_ADMIN").length;
  const health = deriveOrganizationHealth({
    status: org.status,
    latestSubscriptionStatus: latestSubscription?.status ?? null,
    activeOwnerCount,
  });

  return {
    identity: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      organizationType: org.organizationType,
      primaryVertical: org.primaryVertical,
      status: org.status,
      plan: org.plan,
      createdAt: org.createdAt.toISOString(),
      ownerSummary: ownerMembership?.user
        ? { userId: ownerMembership.user.id, email: ownerMembership.user.email, displayName: ownerMembership.user.displayName }
        : null,
      billingExempt: org.billingExempt,
    },
    membership: {
      totalActive: memberships.length,
      roleDistribution,
      pendingInvitations,
      deactivated: deactivatedCount,
      multiOrgMemberCount,
    },
    billing: {
      stripeCustomerId: latestSubscription?.stripeCustomerId ?? null,
      latestSubscription: latestSubscription
        ? {
            status: latestSubscription.status,
            plan: latestSubscription.plan,
            currentPeriodEnd: latestSubscription.currentPeriodEnd?.toISOString() ?? null,
            trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
            cancelAtPeriodEnd: latestSubscription.cancelAtPeriodEnd,
          }
        : null,
    },
    communications: {
      smsAddOnActive: smsSettings?.smsAddOnActive ?? false,
      smsConsentCount,
      smsSentLast30Days,
      smsFailedLast30Days,
    },
    operationalHealth: {
      health,
      recentAuditEvents: recentAuditEvents.map((e) => ({
        id: e.id,
        action: e.action,
        actorEmail: e.actorEmail,
        createdAt: e.createdAt.toISOString(),
      })),
    },
  };
}

export class OrganizationVerticalChangeError extends Error {}

export interface PrimaryVerticalChangePreview {
  organizationId: string;
  currentVertical: OrganizationVertical;
  proposedVertical: OrganizationVertical;
  /** Data that stays intact but goes dormant (hidden from navigation) if the
   * org is moving away from PTA — never deleted, restorable by switching
   * back or re-enrolling. Empty unless currentVertical is PTA. */
  dormantOnChange: { label: string; count: number }[];
  /** True when the PTA Labs feature is enrolled but the org is not (or is no
   * longer) classified PTA — a state worth flagging, not blocking. */
  ptaLabsEnrollmentMismatch: boolean;
}

/**
 * Read-only impact preview shown before a Platform Admin confirms a
 * primary-vertical change — Phase 7's "preview the impact before changing."
 * Never mutates anything.
 */
export async function previewPrimaryVerticalChange(
  organizationId: string,
  proposedVertical: OrganizationVertical
): Promise<PrimaryVerticalChangePreview> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { primaryVertical: true },
  });
  if (!org) throw new OrganizationVerticalChangeError(`Organization not found: ${organizationId}`);

  const dormantOnChange: { label: string; count: number }[] = [];
  if (org.primaryVertical === "PTA" && proposedVertical !== "PTA") {
    const [households, students, volunteerHours] = await Promise.all([
      prisma.ptaHousehold.count({ where: { organizationId } }),
      prisma.ptaStudent.count({ where: { organizationId } }),
      prisma.ptaVolunteerHourEntry.count({ where: { organizationId } }),
    ]);
    if (households > 0) dormantOnChange.push({ label: "Households", count: households });
    if (students > 0) dormantOnChange.push({ label: "Students", count: students });
    if (volunteerHours > 0) dormantOnChange.push({ label: "Volunteer hour entries", count: volunteerHours });
  }

  const ptaLabFeature =
    proposedVertical === "PTA"
      ? await prisma.organizationLabFeature.findUnique({
          where: { organizationId_featureKey: { organizationId, featureKey: "ptaVertical" } },
          select: { status: true },
        })
      : null;

  return {
    organizationId,
    currentVertical: org.primaryVertical,
    proposedVertical,
    dormantOnChange,
    ptaLabsEnrollmentMismatch: proposedVertical === "PTA" && ptaLabFeature?.status !== "ENABLED",
  };
}

/**
 * Changes an organization's primary vertical. Touches only the
 * `primaryVertical` column — never deletes or modifies PTA households,
 * students, dues, Labs enrollment, subscriptions, or any other data, so
 * switching back later (or re-enrolling) restores full access to
 * unmodified history. Always audited.
 */
export async function changeOrganizationPrimaryVertical(input: {
  organizationId: string;
  newVertical: OrganizationVertical;
  actorUserId: string;
  actorEmail: string;
  reason?: string | null;
}): Promise<{ organizationId: string; previousVertical: OrganizationVertical; newVertical: OrganizationVertical }> {
  const org = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { primaryVertical: true },
  });
  if (!org) throw new OrganizationVerticalChangeError(`Organization not found: ${input.organizationId}`);

  const previousVertical = org.primaryVertical;

  if (previousVertical === input.newVertical) {
    return { organizationId: input.organizationId, previousVertical, newVertical: input.newVertical };
  }

  await prisma.organization.update({
    where: { id: input.organizationId },
    data: { primaryVertical: input.newVertical },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "organization.primary_vertical_changed",
    entityType: "organization",
    entityId: input.organizationId,
    metadata: {
      previousVertical,
      newVertical: input.newVertical,
      reason: input.reason ?? null,
    },
  });

  return { organizationId: input.organizationId, previousVertical, newVertical: input.newVertical };
}
