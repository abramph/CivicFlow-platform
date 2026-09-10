import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { executeClaimedSmsRetry } from "@/lib/sms-queue";
import { ValidationError } from "@/lib/validation";

/** POST: retries a FAILED message (mirrors the PaymentReportActions row-action pattern). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id } = await params;

    const message = await prisma.smsMessage.findUnique({ where: { id } });
    if (!message) throw new ValidationError("Message not found.");

    // E2E-6 finding: the previous findUnique-then-update had a TOCTOU gap —
    // two concurrent Retry clicks could both pass the status check before
    // either write landed. The FAILED->RETRYING transition is the atomic
    // eligibility gate: only one concurrent request can win it; the loser
    // sees count 0 and fails cleanly. Round-4 change: this transition only
    // makes the row ELIGIBLE (nextRetryAt = now) — ownership, retryCount,
    // and execution all live in the centralized claimant
    // (executeClaimedSmsRetry), the same single-owner lease path the cron
    // sweep uses, so a manual retry racing the cron can never double-send.
    const eligible = await prisma.smsMessage.updateMany({
      where: { id, status: "FAILED" },
      data: { status: "RETRYING", nextRetryAt: new Date() },
    });
    if (eligible.count === 0) throw new ValidationError("Only failed messages can be retried.");

    const result = await executeClaimedSmsRetry(id);

    if (!result.claimed) {
      // The cron sweep won the claim in the instant between our eligibility
      // transition and our own claim attempt — the retry IS running, just
      // not owned by this request. Report current state; the audit event
      // belongs to whoever actually executes the attempt, so none is
      // written here (one audit per claimed retry, never per competing
      // request).
      const current = await prisma.smsMessage.findUnique({ where: { id } });
      return Response.json({ ok: true, data: current ?? message, alreadyClaimed: true });
    }

    await createAuditEvent({
      organizationId: message.organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.message_retried",
      entityType: "SmsMessage",
      entityId: id,
      metadata: { sent: result.message.status === "SENT" },
    });

    return Response.json({ ok: true, data: result.message });
  });
}
