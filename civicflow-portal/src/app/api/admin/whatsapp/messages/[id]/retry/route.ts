import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { attemptWhatsAppMessageResend } from "@/lib/whatsapp/queue";
import { ValidationError } from "@/lib/validation";

/**
 * POST: retries a FAILED message, mirroring the SMS equivalent. Only
 * freeform/Sandbox sends (a literal body) can actually be retried — see
 * attemptWhatsAppMessageResend()'s doc comment for why template-based sends
 * can't be.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id } = await params;

    const message = await prisma.whatsAppMessage.findUnique({ where: { id } });
    if (!message) throw new ValidationError("Message not found.");
    if (message.status !== "FAILED") throw new ValidationError("Only failed messages can be retried.");

    await prisma.whatsAppMessage.update({
      where: { id },
      data: { status: "SENDING", retryCount: { increment: 1 }, nextRetryAt: new Date() },
    });

    const updated = await attemptWhatsAppMessageResend(message);

    await createAuditEvent({
      organizationId: message.organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "whatsapp_admin.message_retried",
      entityType: "WhatsAppMessage",
      entityId: id,
      metadata: { sent: updated.status === "SENT" },
    });

    return Response.json({ ok: true, data: updated });
  });
}
