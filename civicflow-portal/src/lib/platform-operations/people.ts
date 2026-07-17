import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  normalizePagination,
  paginationResult,
  type PagedResult,
  type PaginationInput,
} from "./types";

export interface PersonListFilters {
  search?: string;
  onlyMultiOrg?: boolean;
  onlyNoActiveMembership?: boolean;
}

export interface PersonMembershipSummary {
  organizationId: string;
  organizationName: string;
  role: string;
  status: string;
}

export interface PersonListItem {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  memberships: PersonMembershipSummary[];
  membershipCount: number;
  hasPlatformAccess: boolean;
  /** No last-sign-in timestamp exists anywhere in this schema — always null, rendered as "Not tracked", never approximated. */
  lastSignInAt: null;
}

function buildWhere(filters: PersonListFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  if (filters.search?.trim()) {
    const term = filters.search.trim();
    where.OR = [
      { email: { contains: term, mode: "insensitive" } },
      { displayName: { contains: term, mode: "insensitive" } },
    ];
  }
  if (filters.onlyNoActiveMembership) {
    where.memberships = { none: { status: "active" } };
  }

  return where;
}

export async function listPeople(
  filters: PersonListFilters,
  pagination: PaginationInput
): Promise<PagedResult<PersonListItem>> {
  const { page, pageSize } = normalizePagination(pagination);
  const where = buildWhere(filters);

  // onlyMultiOrg can't be expressed as a single Prisma where-clause (it's a
  // having-count-> 1 condition across a relation) — filtered in application
  // code after a bounded fetch instead of an unbounded scan: capped at 2000
  // candidate rows, an order of magnitude above any realistic per-page need,
  // to keep this a bounded query even on this filter path.
  if (filters.onlyMultiOrg) {
    const candidates = await prisma.user.findMany({
      where,
      select: { id: true, _count: { select: { memberships: { where: { status: "active" } } } } },
      take: 2000,
    });
    const multiOrgIds = candidates.filter((u) => u._count.memberships > 1).map((u) => u.id);
    return listPeopleByIds(multiOrgIds, { page, pageSize });
  }

  const [totalCount, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: selectFields(),
    }),
  ]);

  return { items: rows.map(toListItem), pagination: paginationResult({ page, pageSize }, totalCount) };
}

async function listPeopleByIds(ids: string[], pagination: PaginationInput): Promise<PagedResult<PersonListItem>> {
  const { page, pageSize } = pagination;
  const totalCount = ids.length;
  const pageIds = ids.slice((page - 1) * pageSize, page * pageSize);

  if (pageIds.length === 0) {
    return { items: [], pagination: paginationResult({ page, pageSize }, totalCount) };
  }

  const rows = await prisma.user.findMany({
    where: { id: { in: pageIds } },
    select: selectFields(),
  });
  // Prisma doesn't preserve `in`-list order — restore it so pagination is stable.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = pageIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));

  return { items: ordered.map(toListItem), pagination: paginationResult({ page, pageSize }, totalCount) };
}

function selectFields() {
  return {
    id: true,
    email: true,
    displayName: true,
    createdAt: true,
    emailVerified: true,
    mfaEnabled: true,
    memberships: {
      where: { status: "active" as const },
      select: { role: true, status: true, organization: { select: { id: true, name: true } } },
    },
    platformAccess: { where: { status: "ACTIVE" as const }, select: { id: true } },
  } satisfies Prisma.UserSelect;
}

function toListItem(row: {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: Date;
  emailVerified: boolean;
  mfaEnabled: boolean;
  memberships: { role: string; status: string; organization: { id: string; name: string } }[];
  platformAccess: { id: string }[];
}): PersonListItem {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    emailVerified: row.emailVerified,
    mfaEnabled: row.mfaEnabled,
    memberships: row.memberships.map((m) => ({
      organizationId: m.organization.id,
      organizationName: m.organization.name,
      role: m.role,
      status: m.status,
    })),
    membershipCount: row.memberships.length,
    hasPlatformAccess: row.platformAccess.length > 0,
    lastSignInAt: null,
  };
}

/** Groups active users by normalized (lowercased, trimmed) email — a same-person signal, never used to auto-merge anything. */
export interface DuplicateEmailGroup {
  normalizedEmail: string;
  userIds: string[];
}

export async function findDuplicateLookingAccounts(limit = 50): Promise<DuplicateEmailGroup[]> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    take: 5000, // bounded scan — see docs/aph-operations-center.md performance limits
  });

  const groups = new Map<string, string[]>();
  for (const u of users) {
    const key = u.email.trim().toLowerCase();
    const list = groups.get(key) ?? [];
    list.push(u.id);
    groups.set(key, list);
  }

  return Array.from(groups.entries())
    .filter(([, ids]) => ids.length > 1)
    .slice(0, limit)
    .map(([normalizedEmail, userIds]) => ({ normalizedEmail, userIds }));
}
