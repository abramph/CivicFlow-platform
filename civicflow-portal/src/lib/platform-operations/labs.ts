import "server-only";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import {
  findLabFeature,
  listLabFeatures,
  type LabFeatureDefinition,
} from "@/lib/labs/registry";
import {
  normalizePagination,
  paginationResult,
  type PagedResult,
  type PaginationInput,
} from "./types";

export function listLabFeatureDefinitions(): LabFeatureDefinition[] {
  return listLabFeatures();
}

export interface LabEnrollmentListItem {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  featureKey: string;
  status: string;
  enabledAt: string | null;
  disabledAt: string | null;
  enrollmentSource: string;
  notes: string | null;
  updatedAt: string;
}

export interface LabEnrollmentFilters {
  featureKey?: string;
  organizationId?: string;
}

/**
 * Paged list of enrollment rows for the Operations Center table — always
 * joined with the organization's current name/slug for display, since
 * those are tenant-editable and must never be trusted from a stale cache.
 */
export async function listLabEnrollments(
  filters: LabEnrollmentFilters,
  pagination: PaginationInput
): Promise<PagedResult<LabEnrollmentListItem>> {
  const { page, pageSize } = normalizePagination(pagination);
  const where = {
    ...(filters.featureKey ? { featureKey: filters.featureKey } : {}),
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
  };

  const [totalCount, rows] = await Promise.all([
    prisma.organizationLabFeature.count({ where }),
    prisma.organizationLabFeature.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { organization: { select: { name: true, slug: true } } },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organization.name,
      organizationSlug: row.organization.slug,
      featureKey: row.featureKey,
      status: row.status,
      enabledAt: row.enabledAt?.toISOString() ?? null,
      disabledAt: row.disabledAt?.toISOString() ?? null,
      enrollmentSource: row.enrollmentSource,
      notes: row.notes,
      updatedAt: row.updatedAt.toISOString(),
    })),
    pagination: paginationResult({ page, pageSize }, totalCount),
  };
}

export interface LabEnrollmentHistoryItem {
  id: string;
  action: string;
  actorEmail: string | null;
  metadata: unknown;
  createdAt: string;
}

/**
 * Enrollment history is reconstructed from AuditEvent rather than a
 * separate history table — every enable/disable write goes through
 * setOrganizationLabEnrollment() below, which always audit-logs, so the
 * audit trail already is the enrollment history. Avoids a second,
 * redundant append-only table for the same information.
 */
export async function getLabEnrollmentHistory(enrollmentId: string): Promise<LabEnrollmentHistoryItem[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { resource: "organization_lab_feature", resourceId: enrollmentId },
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, actorEmail: true, after: true, createdAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorEmail: row.actorEmail,
    metadata: row.after,
    createdAt: row.createdAt.toISOString(),
  }));
}

export class LabEnrollmentValidationError extends Error {}

/**
 * The sole write path for Labs enrollment changes — used by the Operations
 * Center's enable/disable action. Deliberately touches nothing else:
 * no Organization.plan, no Stripe, no Organization.billingExempt, no
 * OrganizationMembership/RBAC row. Always audit-logged with the previous
 * and new status. Validates both the feature key (against the registry)
 * and the organization (must exist) before writing anything.
 */
export async function setOrganizationLabEnrollment(input: {
  organizationId: string;
  featureKey: string;
  status: "ENABLED" | "DISABLED" | "PENDING" | "SUSPENDED";
  actorUserId: string;
  actorEmail: string;
  notes?: string | null;
}): Promise<LabEnrollmentListItem> {
  const feature = findLabFeature(input.featureKey);
  if (!feature) {
    throw new LabEnrollmentValidationError(`Unknown Labs feature key: ${input.featureKey}`);
  }

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, slug: true, billingExempt: true },
  });
  if (!organization) {
    throw new LabEnrollmentValidationError(`Organization not found: ${input.organizationId}`);
  }

  // An internal-only feature can never be turned on for a non-billing-exempt
  // organization — the access resolver would deny it anyway, but allowing
  // the enrollment row itself to say ENABLED here would be a misleading
  // operator-facing state and (per the security review) a path worth
  // closing at the write layer, not just the read layer. DISABLED/SUSPENDED
  // transitions are still allowed unconditionally (e.g. cleaning up a stale
  // row), only ENABLED/PENDING are blocked.
  if (feature.internalOnly && !organization.billingExempt && (input.status === "ENABLED" || input.status === "PENDING")) {
    throw new LabEnrollmentValidationError(
      `${feature.key} is internal-only and cannot be enabled for a non-billing-exempt organization.`
    );
  }

  // A retired feature (e.g. ptaVertical as of PR #40) can never be newly
  // enabled/re-enabled — the whole point of retiring it is that Platform
  // Admin can no longer grant access through it. DISABLED/SUSPENDED
  // transitions on an existing row remain allowed (cleanup), mirroring the
  // internalOnly block above.
  if (feature.lifecycle === "RETIRED" && (input.status === "ENABLED" || input.status === "PENDING")) {
    throw new LabEnrollmentValidationError(
      `${feature.key} is retired and can no longer be enabled for any organization.`
    );
  }

  const existing = await prisma.organizationLabFeature.findUnique({
    where: { organizationId_featureKey: { organizationId: input.organizationId, featureKey: feature.key } },
  });
  const previousStatus = existing?.status ?? null;

  const now = new Date();
  const row = await prisma.organizationLabFeature.upsert({
    where: { organizationId_featureKey: { organizationId: input.organizationId, featureKey: feature.key } },
    create: {
      organizationId: input.organizationId,
      featureKey: feature.key,
      status: input.status,
      enabledAt: input.status === "ENABLED" ? now : null,
      disabledAt: input.status === "DISABLED" ? now : null,
      enabledByUserId: input.status === "ENABLED" ? input.actorUserId : null,
      disabledByUserId: input.status === "DISABLED" ? input.actorUserId : null,
      enrollmentSource: "operations_center",
      notes: input.notes ?? null,
    },
    update: {
      status: input.status,
      ...(input.status === "ENABLED" ? { enabledAt: now, enabledByUserId: input.actorUserId } : {}),
      ...(input.status === "DISABLED" ? { disabledAt: now, disabledByUserId: input.actorUserId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: { organization: { select: { name: true, slug: true } } },
  });

  await createAuditEvent({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: "labs.enrollment.status_changed",
    entityType: "organization_lab_feature",
    entityId: row.id,
    metadata: {
      featureKey: feature.key,
      previousStatus,
      newStatus: input.status,
      notes: input.notes ?? null,
    },
  });

  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organization.name,
    organizationSlug: row.organization.slug,
    featureKey: row.featureKey,
    status: row.status,
    enabledAt: row.enabledAt?.toISOString() ?? null,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    enrollmentSource: row.enrollmentSource,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}
