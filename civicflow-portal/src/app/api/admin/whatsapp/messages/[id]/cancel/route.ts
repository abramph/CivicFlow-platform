import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

// WhatsAppMessageStatus has no RETRYING value (unlike SmsMessageStatus) —
// SENDING is the interim marker the retry route sets before attempting a
// resend, and is otherwise unused by the primary send path (which resolves
// synchronously straight to SENT/FAILED), so it's safe to treat the same way
// SMS treats RETRYING here.
const CANCELABLE_STATUSES = new Set(["QUEUED", "SENDING"]);

/** POST: cancels a message still in the queue (QUEUED or SENDING), marking it FAILED without attempting a send. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id } = await params;

    const message = await prisma.whatsAppMessage.findUnique({ where: { id } });
    if (!message) throw new ValidationError("Message not found.");
    if (!CANCELABLE_STATUSES.has(message.status)) {
      throw new ValidationError("Only queued or in-flight messages can be cancelled.");
    }

    const updated = await prisma.whatsAppMessage.update({
      where: { id },
      data: { status: "FAILED", failedAt: new Date(), errorMessage: "Cancelled by admin." },
    });

    await createAuditEvent({
      organizationId: message.organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "whatsapp_admin.message_cancelled",
      entityType: "WhatsAppMessage",
      entityId: id,
    });

    return Response.json({ ok: true, data: updated });
  });
}
