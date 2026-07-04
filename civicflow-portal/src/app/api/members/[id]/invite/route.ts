import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { getMobileAppWebBaseUrl } from "@/lib/env";
import { sendEmail } from "@/lib/mail";
import { createMemberInvite } from "@/lib/member-invites";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError } from "@/lib/validation";

/**
 * Admin-initiated invite for a member to create CivicFlow mobile/web login
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

    const token = await createMemberInvite({
      organizationId,
      memberId: member.id,
      createdByUserId: session.userId,
    });

    const acceptUrl = `${getMobileAppWebBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });

    await sendEmail({
      to: member.email,
      subject: `You're invited to the CivicFlow app${org?.name ? ` — ${org.name}` : ""}`,
      text: [
        `${org?.name ?? "Your organization"} has invited you to use the CivicFlow mobile app.`,
        "",
        "Set up your login to check your dues status, report a payment, and receive announcements.",
        "",
        acceptUrl,
        "",
        "This invite link expires in 7 days.",
      ].join("\n"),
      html: `
        <p><strong>${org?.name ?? "Your organization"}</strong> has invited you to use the CivicFlow mobile app.</p>
        <p>Set up your login to check your dues status, report a payment, and receive announcements.</p>
        <p style="margin:24px 0">
          <a href="${acceptUrl}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
            Set Up My Account
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px">Or copy this link: ${acceptUrl}</p>
        <p style="color:#6b7280;font-size:13px">This invite link expires in 7 days.</p>
      `.trim(),
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
