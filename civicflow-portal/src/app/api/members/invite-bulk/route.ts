import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { buildMemberWhere, parseMemberFilters } from "@/lib/member-filters";
import { sendMemberAppInviteEmail } from "@/lib/member-invites";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

// Matches the campaign-sending scaling fix: bound how many invites one
// request will actually send, and process them with concurrency instead of
// one at a time. Under this size (every org today) a bulk invite completes
// fully in one click; a larger org just re-clicks to pick up the remainder —
// safe, since already-invited members are skipped on the next call.
const BULK_INVITE_BATCH_SIZE = 300;
const SEND_CONCURRENCY = 10;
const RECENT_INVITE_WINDOW_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_CAP = 5000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const bodySchema = z.object({
  filters: z.record(z.string(), z.string()).optional(),
  preview: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:invite-bulk",
      request,
      limit: 5,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");
    const input = await parseJsonBody(request, bodySchema);
    const filters = parseMemberFilters(input.filters ?? {});
    const where = buildMemberWhere(organizationId, filters);

    const candidates = await prisma.orgMember.findMany({
      where,
      select: { id: true, email: true, userId: true },
      take: CANDIDATE_CAP,
    });

    const alreadyLinked = candidates.filter((member) => member.userId).length;
    const noEmail = candidates.filter((member) => !member.userId && !member.email).length;
    const eligibleMembers = candidates.filter(
      (member): member is { id: string; email: string; userId: null } => !member.userId && Boolean(member.email)
    );

    // Skip members who already have a still-valid, unaccepted invite
    // outstanding, so repeated bulk-invite clicks don't spam duplicate
    // emails to people who just haven't accepted yet.
    const pendingInvites = eligibleMembers.length
      ? await prisma.memberInvite.findMany({
          where: {
            organizationId,
            memberId: { in: eligibleMembers.map((member) => member.id) },
            acceptedAt: null,
            expiresAt: { gt: new Date() },
            createdAt: { gt: new Date(Date.now() - RECENT_INVITE_WINDOW_MS) },
          },
          select: { memberId: true },
        })
      : [];
    const alreadyPendingIds = new Set(pendingInvites.map((invite) => invite.memberId));
    const toInvite = eligibleMembers.filter((member) => !alreadyPendingIds.has(member.id));

    if (input.preview) {
      return Response.json({
        ok: true,
        data: {
          matching: candidates.length,
          eligible: toInvite.length,
          alreadyLinked,
          noEmail,
          alreadyPending: alreadyPendingIds.size,
        },
      });
    }

    const batch = toInvite.slice(0, BULK_INVITE_BATCH_SIZE);
    const remaining = Math.max(0, toInvite.length - batch.length);

    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

    let invited = 0;
    let failed = 0;
    for (const group of chunk(batch, SEND_CONCURRENCY)) {
      const results = await Promise.allSettled(
        group.map((member) =>
          sendMemberAppInviteEmail({
            member: { id: member.id, email: member.email },
            organizationId,
            organizationName: organization?.name ?? null,
            createdByUserId: session.userId,
          })
        )
      );
      for (const result of results) {
        if (result.status === "fulfilled") invited += 1;
        else failed += 1;
      }
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "member.bulk_invite_to_app",
      entityType: "member",
      metadata: { invited, failed, alreadyLinked, noEmail, alreadyPending: alreadyPendingIds.size, remaining, filters },
    });

    return Response.json({
      ok: true,
      data: { invited, failed, alreadyLinked, noEmail, alreadyPending: alreadyPendingIds.size, remaining },
    });
  });
}
