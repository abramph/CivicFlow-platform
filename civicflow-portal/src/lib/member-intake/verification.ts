import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/mail";
import { generateOtpCode, hashOtpCode, otpExpiresAt, maskPhone } from "@/lib/sms-otp";
import { MemberIntakeError } from "./errors";

/**
 * Member Intake & Profile Update (MEMBER-QR-A) — identity verification for a
 * submission that CONFIDENT_MATCHed an existing member. Deliberately narrow:
 * this module only ever proves the submitter controls a channel already on
 * file for the matched member. It never decides what happens after
 * verification succeeds -- that orchestration (auto-apply vs. still-needs-
 * review) lives in update-engine.ts, kept separate so the one rule that
 * matters most here stays impossible to accidentally violate by mixing it
 * into a larger function: the destination is ALWAYS read from the matched
 * OrgMember row, NEVER from the submission's own fieldValues. A submission
 * that proposes changing an email can never use that new email to verify
 * itself -- see §15's explicit rule. If the matched member has no trusted
 * email or phone on file at all, there is nothing this module can do; that
 * case is routed to admin review instead (see submissions.ts / update-engine.ts).
 */

function maskEmailForDisplay(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const maskedLocal = local.length <= 2 ? local[0] + "*" : local.slice(0, 2) + "***";
  return `${maskedLocal}@${domain}`;
}

export interface VerificationRequestResult {
  channel: "EMAIL" | "SMS";
  maskedDestination: string;
}

/**
 * Sends a fresh one-time code to the matched member's own trusted email
 * (preferred) or phone on file. Invalidates any previously issued,
 * unconsumed token for this submission first -- only one code is ever live
 * at a time, same idiom as the sms_opt_in MfaChallengeToken flow.
 */
export async function requestVerification(organizationId: string, submissionId: string): Promise<VerificationRequestResult> {
  const submission = await prisma.memberIntakeSubmission.findFirst({
    where: { id: submissionId, organizationId },
    include: { matchedMember: { select: { id: true, email: true, phone: true } } },
  });
  if (!submission) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");
  if (submission.status !== "VERIFICATION_REQUIRED" || !submission.matchedMember) {
    throw new MemberIntakeError("MEMBER_INTAKE_VERIFICATION_NOT_APPLICABLE", "This submission does not require identity verification.");
  }

  // Existing, trusted destinations only -- never anything the submitter just
  // typed into the form. Email preferred over SMS purely because it's free;
  // either is an equally valid trust signal.
  const destination = submission.matchedMember.email ?? submission.matchedMember.phone ?? null;
  const channel: "EMAIL" | "SMS" | null = submission.matchedMember.email ? "EMAIL" : submission.matchedMember.phone ? "SMS" : null;
  if (!destination || !channel) {
    throw new MemberIntakeError(
      "MEMBER_INTAKE_VERIFICATION_NOT_APPLICABLE",
      "No verified contact method is on file for this member. An administrator must review this submission instead."
    );
  }

  await prisma.memberIntakeVerificationToken.deleteMany({ where: { submissionId: submission.id, consumedAt: null } });

  const code = generateOtpCode();
  await prisma.memberIntakeVerificationToken.create({
    data: {
      submissionId: submission.id,
      channel,
      destination,
      codeHash: hashOtpCode(code),
      expiresAt: otpExpiresAt(),
    },
  });

  if (channel === "EMAIL") {
    await sendEmail({
      to: destination,
      subject: "Your Unestra verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    });
    return { channel, maskedDestination: maskEmailForDisplay(destination) };
  }

  await sendSms({ to: destination, body: `Your Unestra verification code is ${code}. It expires in 10 minutes.` });
  return { channel, maskedDestination: maskPhone(destination) };
}

export type VerifyCodeResult = { ok: true } | { ok: false; error: string };

/**
 * MEMBER-QR-E hardening: the token-scoped attempt cap §15 explicitly
 * requires ("attempt limited" is listed as a property of the token itself,
 * not just something the route enforces). A route-level IP rate limit alone
 * is insufficient -- it's trivially bypassed by rotating source IPs, and a
 * 6-digit code has only 1,000,000 possibilities, brute-forceable well
 * within its 10-minute window without a per-token cap. Once a token hits
 * this many wrong guesses it is burned (see below) -- the submitter must
 * request a fresh code, not keep guessing against the dead one.
 */
const MAX_VERIFICATION_ATTEMPTS = 5;

/**
 * Checks a submitted code against the most recent unconsumed token for this
 * submission. On success, marks the token consumed and flips the
 * submission's verificationStatus to VERIFIED -- it does NOT apply any
 * member changes itself (see update-engine.ts's applySubmission, called
 * separately by the route once this returns ok). Per-IP request-rate
 * limiting is enforced at the route layer via requireRateLimit, same as
 * every other OTP-confirm route in this codebase (see member-portal/
 * notifications/confirm/route.ts); the token-scoped attempt cap here is the
 * complementary backstop that survives IP rotation.
 */
export async function verifySubmissionCode(organizationId: string, submissionId: string, code: string): Promise<VerifyCodeResult> {
  const submission = await prisma.memberIntakeSubmission.findFirst({ where: { id: submissionId, organizationId } });
  if (!submission) throw new MemberIntakeError("MEMBER_INTAKE_SUBMISSION_NOT_FOUND", "Submission not found.");
  if (submission.status !== "VERIFICATION_REQUIRED") {
    throw new MemberIntakeError("MEMBER_INTAKE_VERIFICATION_NOT_APPLICABLE", "This submission does not require identity verification.");
  }

  const token = await prisma.memberIntakeVerificationToken.findFirst({
    where: { submissionId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token) return { ok: false, error: "No verification code is pending for this submission. Request a new one." };
  if (token.expiresAt < new Date()) return { ok: false, error: "This code has expired. Request a new one." };

  if (hashOtpCode(code.trim().replace(/\s/g, "")) !== token.codeHash) {
    // An atomic DB-level increment (not read-token.attempts-then-write) so
    // concurrent guesses against the same token can't race past the cap via
    // a lost-update.
    const updated = await prisma.memberIntakeVerificationToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });
    if (updated.attempts >= MAX_VERIFICATION_ATTEMPTS) {
      await prisma.memberIntakeVerificationToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
      return { ok: false, error: "Too many incorrect attempts. Request a new code." };
    }
    return { ok: false, error: "Invalid code. Please try again." };
  }

  await prisma.memberIntakeVerificationToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
  await prisma.memberIntakeSubmission.update({
    where: { id: submission.id },
    data: { verificationStatus: "VERIFIED" },
  });

  return { ok: true };
}
