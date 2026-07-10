import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { sendMemberAppInviteEmail } from "@/lib/member-invites";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";

/**
 * Admin-initiated invite for a member to create Unestra mobile/web login
 * credentials. No open self-signup surface — only staff with members:write
 * can trigger this, scoped to one specific member record.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:members:invite",
      request,
      limit: 20,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("members:write", "throw");
    const { id } = await params;

    const member = await prisma.orgMember.findFirst({ where: { id, organizationId } });
    if (!member) {
      return Response.json({ ok: false, error: "Member not found" }, { status: 404 });
    }
    if (member.userId) {
      throw new ValidationError("This member already has app login credentials.");
    }
    if (!member.email) {
      throw new ValidationError("Add an email address for this member before sending an app invite.");
    }

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

    await sendMemberAppInviteEmail({
      member: { id: member.id, email: member.email },
      organizationId,
      organizationName: org?.name ?? null,
      createdByUserId: session.userId,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "member.invite_to_app",
      entityType: "member",
      entityId: member.id,
    });

    return Response.json({ ok: true });
  });
}
