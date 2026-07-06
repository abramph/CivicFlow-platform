import crypto from "crypto";
import { getMobileAppWebBaseUrl } from "@/lib/env";
import { sendEmail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Creates a single-use invite for an OrgMember to set up mobile/web login
 * credentials. Returns the raw token (only ever available at creation time —
 * only its hash is persisted) for embedding in the invite email link.
 */
export async function createMemberInvite(params: {
  organizationId: string;
  memberId: string;
  createdByUserId?: string | null;
}): Promise<string> {
  const token = generateToken();

  await prisma.memberInvite.deleteMany({
    where: { organizationId: params.organizationId, memberId: params.memberId, acceptedAt: null },
  });

  await prisma.memberInvite.create({
    data: {
      organizationId: params.organizationId,
      memberId: params.memberId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
      createdByUserId: params.createdByUserId ?? null,
    },
  });

  return token;
}

export async function consumeMemberInvite(
  rawToken: string
): Promise<
  | { ok: true; organizationId: string; memberId: string; inviteId: string }
  | { ok: false; error: string }
> {
  const tokenHash = hashToken(rawToken);
  const invite = await prisma.memberInvite.findUnique({ where: { tokenHash } });

  if (!invite) return { ok: false, error: "Invalid or expired invite link." };
  if (invite.acceptedAt) return { ok: false, error: "This invite has already been used." };
  if (invite.expiresAt < new Date()) return { ok: false, error: "This invite has expired. Ask your organization to send a new one." };

  return { ok: true, organizationId: invite.organizationId, memberId: invite.memberId, inviteId: invite.id };
}

export async function markMemberInviteAccepted(inviteId: string) {
  await prisma.memberInvite.update({ where: { id: inviteId }, data: { acceptedAt: new Date() } });
}

/**
 * Creates an invite token and sends the invite email — the one path both the
 * single-member invite route and the bulk-invite route go through, so the
 * email copy only lives in one place.
 */
export async function sendMemberAppInviteEmail(params: {
  member: { id: string; email: string };
  organizationId: string;
  organizationName: string | null;
  createdByUserId?: string | null;
}): Promise<void> {
  const token = await createMemberInvite({
    organizationId: params.organizationId,
    memberId: params.member.id,
    createdByUserId: params.createdByUserId,
  });

  const acceptUrl = `${getMobileAppWebBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
  const orgName = params.organizationName ?? "Your organization";

  await sendEmail({
    to: params.member.email,
    subject: `You're invited to the CivicFlow app — ${orgName}`,
    text: [
      `${orgName} has invited you to use the CivicFlow mobile app.`,
      "",
      "Set up your login to check your dues status, report a payment, and receive announcements.",
      "",
      acceptUrl,
      "",
      "This invite link expires in 7 days.",
    ].join("\n"),
    html: `
      <p><strong>${orgName}</strong> has invited you to use the CivicFlow mobile app.</p>
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
}
