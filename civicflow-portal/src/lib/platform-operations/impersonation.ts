import { prisma } from "@/lib/prisma";

export interface ImpersonationCandidate {
  userId: string;
  displayName: string | null;
  email: string;
  role: string;
}

/** Every active member of an organization, for the "Impersonate User" picker. Read-only. */
export async function listOrganizationMembersForImpersonation(organizationId: string): Promise<ImpersonationCandidate[]> {
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId, status: "active" },
    include: { user: { select: { id: true, displayName: true, email: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => ({
    userId: m.user.id,
    displayName: m.user.displayName,
    email: m.user.email,
    role: m.role,
  }));
}

export interface ImpersonationHistoryEntry {
  id: string;
  action: string;
  organizationId: string | null;
  organizationName: string | null;
  actorEmail: string | null;
  metadata: unknown;
  createdAt: Date;
}

/** Recent impersonation start/end audit events, platform-wide — read-only, for the admin's own visibility into past sessions. */
export async function listRecentImpersonationSessions(limit = 50): Promise<ImpersonationHistoryEntry[]> {
  const events = await prisma.auditEvent.findMany({
    where: { action: { in: ["platform.impersonation.started", "platform.impersonation.ended"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { organization: { select: { name: true } } },
  });
  return events.map((e) => ({
    id: e.id,
    action: e.action,
    organizationId: e.organizationId,
    organizationName: e.organization?.name ?? null,
    actorEmail: e.actorEmail,
    metadata: e.after,
    createdAt: e.createdAt,
  }));
}
