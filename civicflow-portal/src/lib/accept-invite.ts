import bcrypt from "bcryptjs";
import { consumeMemberInvite, markMemberInviteAccepted } from "@/lib/member-invites";
import { prisma } from "@/lib/prisma";
import { recordSmsOptIn } from "@/lib/sms-consent";

export interface AcceptInviteSmsConsent {
  /** E.164 phone number, if the member entered one on the accept-invite form. */
  phone?: string | null;
  /** Whether they checked the SMS consent box — independent of just entering a phone. */
  optIn?: boolean;
  ip?: string;
}

/**
 * Consumes a member app invite: creates or links the User account, upserts
 * their MEMBER-role OrganizationMembership, and marks the invite accepted.
 * Shared by the mobile and web accept-invite routes — mobile additionally
 * signs a bearer token pair on top of this; web just redirects to /login.
 * `smsConsent` is optional and web-only today (requirement: capture SMS
 * opt-in at registration) — mobile's accept-invite route doesn't pass it.
 */
export async function acceptMemberInvite(
  token: string,
  password: string,
  smsConsent?: AcceptInviteSmsConsent
): Promise<
  | { ok: true; user: { id: string; email: string; displayName: string | null }; mobileTokenVersion: number }
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
        mfaBackupCodes: [],
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

  if (smsConsent?.phone) {
    if (smsConsent.optIn) {
      await recordSmsOptIn({
        organizationId,
        memberId: member.id,
        phone: smsConsent.phone,
        ip: smsConsent.ip ?? "unknown",
        method: "WEBSITE_REGISTRATION",
        actorUserId: user.id,
      });
    } else {
      // Phone entered but consent box left unchecked — save the number on
      // file without granting SMS consent; it can be used to opt in later.
      await prisma.orgMember.update({ where: { id: member.id }, data: { phone: smsConsent.phone } });
    }
  }

  return {
    ok: true,
    user: { id: user.id, email: user.email, displayName: user.displayName },
    mobileTokenVersion: user.mobileTokenVersion,
  };
}
