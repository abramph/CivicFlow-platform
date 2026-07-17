import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redactAuditMetadata } from "./redaction";
import {
  normalizePagination,
  paginationResult,
  type PagedResult,
  type PaginationInput,
} from "./types";

export interface AuditEventFilters {
  /** Default true: only organizationId === null (platform-level) events. Set false to include organization-scoped events too. */
  platformOnly?: boolean;
  action?: string;
  actorEmail?: string;
  organizationId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface AuditEventListItem {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  actorEmail: string | null;
  organizationId: string | null;
  createdAt: string;
}

export interface AuditEventDetail extends AuditEventListItem {
  before: unknown;
  after: unknown;
  ipAddress: string | null;
}

/**
 * AuditEvent has no `success`/`failure` boolean and no `correlationId`
 * column — those two filters from the original spec are not implementable
 * against the current schema and are deliberately not exposed here rather
 * than faked. (Failure-shaped actions, e.g. SMS/email delivery failures,
 * are visible on the Communications page instead, sourced from SmsMessage/
 * EmailReminderLog.status, which DO carry a real status field.)
 */
function buildWhere(filters: AuditEventFilters): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = {};

  if (filters.organizationId) {
    where.organizationId = filters.organizationId;
  } else if (filters.platformOnly !== false) {
    where.organizationId = null;
  }

  if (filters.action?.trim()) where.action = { contains: filters.action.trim(), mode: "insensitive" };
  if (filters.actorEmail?.trim()) where.actorEmail = { contains: filters.actorEmail.trim(), mode: "insensitive" };
  if (filters.startDate || filters.endDate) {
    where.createdAt = {
      ...(filters.startDate ? { gte: filters.startDate } : {}),
      ...(filters.endDate ? { lte: filters.endDate } : {}),
    };
  }

  return where;
}

export async function listAuditEvents(
  filters: AuditEventFilters,
  pagination: PaginationInput
): Promise<PagedResult<AuditEventListItem>> {
  const { page, pageSize } = normalizePagination(pagination);
  const where = buildWhere(filters);

  const [totalCount, rows] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, action: true, resource: true, resourceId: true, actorEmail: true, organizationId: true, createdAt: true },
    }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      resource: r.resource,
      resourceId: r.resourceId,
      actorEmail: r.actorEmail,
      organizationId: r.organizationId,
      createdAt: r.createdAt.toISOString(),
    })),
    pagination: paginationResult({ page, pageSize }, totalCount),
  };
}

export async function getAuditEventDetail(id: string): Promise<AuditEventDetail | null> {
  const row = await prisma.auditEvent.findUnique({
    where: { id },
    select: {
      id: true,
      action: true,
      resource: true,
      resourceId: true,
      actorEmail: true,
      organizationId: true,
      createdAt: true,
      before: true,
      after: true,
      ipAddress: true,
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId,
    actorEmail: row.actorEmail,
    organizationId: row.organizationId,
    createdAt: row.createdAt.toISOString(),
    before: redactAuditMetadata(row.before),
    after: redactAuditMetadata(row.after),
    ipAddress: row.ipAddress,
  };
}

/** Distinct action values seen among platform-level events, for the event-type filter dropdown. Bounded/cheap: DISTINCT over an indexed-ish column, not a full scan of event bodies. */
export async function listDistinctPlatformActions(limit = 100): Promise<string[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { organizationId: null },
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
    take: limit,
  });
  return rows.map((r) => r.action);
}
