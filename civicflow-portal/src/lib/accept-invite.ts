import bcrypt from "bcryptjs";
import { consumeMemberInvite, markMemberInviteAccepted } from "@/lib/member-invites";
import { prisma } from "@/lib/prisma";

/**
 * Consumes a member app invite: creates or links the User account, upserts
 * their MEMBER-role OrganizationMembership, and marks the invite accepted.
 * Shared by the mobile and web accept-invite routes — mobile additionally
 * signs a bearer token pair on top of this; web just redirects to /login.
 */
export async function acceptMemberInvite(
  token: string,
  password: string
): Promise<
  | { ok: true; user: { id: string; email: string; displayName: string | null } }
  | { ok: false; error: string }
> {
  const result = await consumeMemberInvite(token);
  if (!result.ok) return { ok: false, error: result.error };
  const { organizationId, memberId, inviteId } = result;

  const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
  if (!member) return { ok: false, error: "This member record no longer exists." };
  if (member.userId) return { ok: false, error: "This member already has app login credentials." };
  if (!member.email) return { ok: false, error: "This member has no email on file to link an account to." };

  const normalizedEmail = member.email.trim().toLowerCase();
  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    const passwordHash = await bcrypt.hash(password, 12);
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: `${member.firstName} ${member.lastName}`.trim(),
        passwordHash,
        emailVerified: true,
      },
    });
  } else {
    // An account with this email already exists — holding the invite token
    // (sent to the member's inbox) is not proof of controlling that account,
    // so require its real password before linking the member record to it.
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return { ok: false, error: "An account with this email already exists. Enter that account's password to link it." };
    }
  }

  await prisma.$transaction([
    prisma.orgMember.update({ where: { id: member.id }, data: { userId: user.id } }),
    prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: { organizationId, userId: user.id, role: "MEMBER" },
      update: {},
    }),
  ]);

  await markMemberInviteAccepted(inviteId);

  return { ok: true, user: { id: user.id, email: user.email, displayName: user.displayName } };
}
