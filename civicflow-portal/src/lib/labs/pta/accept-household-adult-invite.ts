import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { consumePtaHouseholdAdultInvite } from "@/lib/labs/pta/household-adult-invites";
import { prisma } from "@/lib/prisma";

/**
 * Consumes a PTA household-adult app invite: creates or links the User
 * account and links PtaHouseholdAdult.userId. Deliberately mirrors
 * acceptMemberInvite()'s account-creation/linking logic but targets
 * PtaHouseholdAdult instead of OrgMember, and never creates or touches an
 * OrgMember row — the household billing OrgMember and its adults are
 * different identities (PR #80/#81 architecture), and this flow has no
 * reason to conflate them.
 *
 * Does NOT create an OrganizationMembership either — per org-context.ts's
 * getUserOrgMemberships() (and the identical branch in
 * /api/mobile/organizations), a PTA household adult deliberately has no
 * OrganizationMembership row at all; session/org-switcher resolution already
 * synthesizes a "MEMBER" entry purely from PtaHouseholdAdult.userId. Creating
 * a real OrganizationMembership here would be redundant with that mechanism
 * and would misrepresent a parent as holding an actual staff/constituent
 * membership.
 *
 * Security properties, all server-authoritative (no client-supplied
 * household/adult id is ever trusted):
 *  - consumePtaHouseholdAdultInvite() atomically claims the token, so a
 *    replayed/concurrent accept of the same token can only ever succeed once.
 *  - The target adult is resolved solely from the invite row (tokenHash ->
 *    householdAdultId), scoped to the invite's own organizationId — a token
 *    can never resolve into a different tenant's adult.
 *  - An adult already linked to a user (adult.userId set) is rejected —
 *    guards against duplicate/overwrite linkage.
 *  - Linking to a pre-existing account requires proving its real password
 *    (holding the invite email is not proof of controlling that account) —
 *    identical requirement to acceptMemberInvite().
 */
export async function acceptPtaHouseholdAdultInvite(
  token: string,
  password: string
): Promise<
  | { ok: true; user: { id: string; email: string; displayName: string | null }; mobileTokenVersion: number }
  | { ok: false; error: string }
> {
  const result = await consumePtaHouseholdAdultInvite(token);
  if (!result.ok) return { ok: false, error: result.error };
  const { organizationId, householdAdultId, inviteId } = result;

  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { id: householdAdultId, organizationId } });
  if (!adult) return { ok: false, error: "This household record no longer exists." };
  if (adult.userId) return { ok: false, error: "This person already has app login credentials." };
  if (!adult.email) return { ok: false, error: "This person has no email on file to link an account to." };

  const normalizedEmail = adult.email.trim().toLowerCase();
  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  const isNewAccount = !user;

  if (!user) {
    const passwordHash = await bcrypt.hash(password, 12);
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: adult.name,
        passwordHash,
        emailVerified: true,
        mfaBackupCodes: [],
      },
    });
  } else {
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return { ok: false, error: "An account with this email already exists. Enter that account's password to link it." };
    }
  }

  // adult.userId was already re-checked above, but the composite unique
  // constraint (organizationId, userId) is the real backstop: if this same
  // user is somehow already linked to a different adult in this org (e.g.
  // two different adults sharing an email, invited separately), this update
  // fails cleanly instead of silently creating a second linkage.
  try {
    await prisma.ptaHouseholdAdult.update({ where: { id: adult.id }, data: { userId: user.id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "This account is already linked to a different person in this organization." };
    }
    throw error;
  }

  await createAuditEvent({
    organizationId,
    actorUserId: user.id,
    actorEmail: user.email,
    action: "pta.household_adult.invite_accepted",
    entityType: "pta_household_adult",
    entityId: adult.id,
    metadata: { inviteId },
  });

  // No PII — ids and a new-vs-existing-account flag only.
  console.log(
    JSON.stringify({
      event: "pta_household_adult_invite_accepted",
      organizationId,
      householdAdultId: adult.id,
      inviteId,
      newAccount: isNewAccount,
    })
  );

  return {
    ok: true,
    user: { id: user.id, email: user.email, displayName: user.displayName },
    mobileTokenVersion: user.mobileTokenVersion,
  };
}
