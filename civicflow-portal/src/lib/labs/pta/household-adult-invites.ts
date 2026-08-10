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
 * Creates a single-use invite for a PtaHouseholdAdult to set up mobile/web
 * login credentials. Household-adult counterpart to createMemberInvite() —
 * kept as a separate table/function (see PtaHouseholdAdultInvite's schema
 * doc comment) rather than reusing MemberInvite, since an adult is not an
 * OrgMember. Returns the raw token (only ever available at creation time —
 * only its hash is persisted) for embedding in the invite email link.
 */
export async function createPtaHouseholdAdultInvite(params: {
  organizationId: string;
  householdAdultId: string;
  createdByUserId?: string | null;
}): Promise<string> {
  const token = generateToken();

  // Transactional so two near-simultaneous "Invite to app" clicks can never
  // both leave a live invite behind: without this, an interleaved
  // delete/delete/create/create ordering could leave two valid unaccepted
  // tokens for the same adult (accept-time's adult.userId re-check still
  // prevents any double-linking either way, but this closes the race at the
  // source instead of relying on that backstop).
  await prisma.$transaction([
    prisma.ptaHouseholdAdultInvite.deleteMany({
      where: { organizationId: params.organizationId, householdAdultId: params.householdAdultId, acceptedAt: null },
    }),
    prisma.ptaHouseholdAdultInvite.create({
      data: {
        organizationId: params.organizationId,
        householdAdultId: params.householdAdultId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
        createdByUserId: params.createdByUserId ?? null,
      },
    }),
  ]);

  return token;
}

/**
 * Atomically claims an invite token: the acceptedAt write happens in the
 * same conditional UPDATE that validates the token is unexpired and unused,
 * so two concurrent accept requests for the same token can never both
 * proceed — the loser's updateMany affects zero rows and gets a clean
 * "already used" error, instead of racing accept logic afterward the way a
 * separate consume-then-mark-accepted pair would.
 */
export async function consumePtaHouseholdAdultInvite(
  rawToken: string
): Promise<
  | { ok: true; organizationId: string; householdAdultId: string; inviteId: string }
  | { ok: false; error: string }
> {
  const tokenHash = hashToken(rawToken);
  const invite = await prisma.ptaHouseholdAdultInvite.findUnique({ where: { tokenHash } });

  // No PII, no token — a reason category only, so a support ticket like
  // "my invite link doesn't work" is traceable via `doctl apps logs` without
  // needing a database query, matching this module's other structured events.
  const rejected = (reason: "not_found" | "already_used" | "expired" | "race_lost") =>
    console.warn(JSON.stringify({ event: "pta_household_adult_invite_rejected", reason }));

  if (!invite) {
    rejected("not_found");
    return { ok: false, error: "Invalid or expired invite link." };
  }
  if (invite.acceptedAt) {
    rejected("already_used");
    return { ok: false, error: "This invite has already been used." };
  }
  if (invite.expiresAt < new Date()) {
    rejected("expired");
    return { ok: false, error: "This invite has expired. Ask your PTA to send a new one." };
  }

  const claim = await prisma.ptaHouseholdAdultInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date() },
  });
  if (claim.count === 0) {
    rejected("race_lost");
    return { ok: false, error: "This invite has already been used." };
  }

  return { ok: true, organizationId: invite.organizationId, householdAdultId: invite.householdAdultId, inviteId: invite.id };
}

/**
 * Creates an invite token and sends the invite email — the one path the
 * officer-invite route goes through, so the email copy only lives in one
 * place (mirrors sendMemberAppInviteEmail).
 */
export async function sendPtaHouseholdAdultInviteEmail(params: {
  householdAdult: { id: string; email: string; name: string };
  organizationId: string;
  organizationName: string | null;
  createdByUserId?: string | null;
}): Promise<void> {
  const token = await createPtaHouseholdAdultInvite({
    organizationId: params.organizationId,
    householdAdultId: params.householdAdult.id,
    createdByUserId: params.createdByUserId,
  });

  const acceptUrl = `${getMobileAppWebBaseUrl()}/accept-pta-invite?token=${encodeURIComponent(token)}`;
  const orgName = params.organizationName ?? "Your PTA";

  await sendEmail({
    to: params.householdAdult.email,
    subject: `You're invited to the Unestra app — ${orgName}`,
    text: [
      `${orgName} has invited you to use the Unestra mobile app.`,
      "",
      "Set up your login to see your household's dues status, volunteer opportunities, and receive announcements.",
      "",
      acceptUrl,
      "",
      "This invite link expires in 7 days.",
    ].join("\n"),
    html: `
      <p><strong>${orgName}</strong> has invited you to use the Unestra mobile app.</p>
      <p>Set up your login to see your household's dues status, volunteer opportunities, and receive announcements.</p>
      <p style="margin:24px 0">
        <a href="${acceptUrl}" style="background:#059669;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">
          Set Up My Account
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px">Or copy this link: ${acceptUrl}</p>
      <p style="color:#6b7280;font-size:13px">This invite link expires in 7 days.</p>
    `.trim(),
  });

  // No PII, no token — ids only.
  console.log(
    JSON.stringify({ event: "pta_household_adult_invited", organizationId: params.organizationId, householdAdultId: params.householdAdult.id })
  );
}
