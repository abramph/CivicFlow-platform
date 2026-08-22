import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { attemptSmsMessageResend } from "@/lib/sms-queue";
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
    // either write landed, both flip to RETRYING, and both call sendSms.
    // Making the FAILED->RETRYING transition itself the atomic claim (like
    // the campaign FAILED->READY reset) means only one concurrent request
    // can ever win it; the loser sees count 0 and fails cleanly instead of
    // double-sending.
    const claimed = await prisma.smsMessage.updateMany({
      where: { id, status: "FAILED" },
      data: { status: "RETRYING", retryCount: { increment: 1 }, nextRetryAt: new Date() },
    });
    if (claimed.count === 0) throw new ValidationError("Only failed messages can be retried.");

    const updated = await attemptSmsMessageResend(message);

    await createAuditEvent({
      organizationId: message.organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.message_retried",
      entityType: "SmsMessage",
      entityId: id,
      metadata: { sent: updated.status === "SENT" },
    });

    return Response.json({ ok: true, data: updated });
  });
}
