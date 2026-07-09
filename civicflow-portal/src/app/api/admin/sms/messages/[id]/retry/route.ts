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
    if (message.status !== "FAILED") throw new ValidationError("Only failed messages can be retried.");

    await prisma.smsMessage.update({
      where: { id },
      data: { status: "RETRYING", retryCount: { increment: 1 }, nextRetryAt: new Date() },
    });

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
