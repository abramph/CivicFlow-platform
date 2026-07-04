import crypto from "crypto";
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
