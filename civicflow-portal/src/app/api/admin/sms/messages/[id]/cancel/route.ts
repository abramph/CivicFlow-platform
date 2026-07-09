import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

const CANCELABLE_STATUSES = new Set(["QUEUED", "RETRYING"]);

/** POST: cancels a message still in the queue (QUEUED or RETRYING), marking it FAILED without attempting a send. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id } = await params;

    const message = await prisma.smsMessage.findUnique({ where: { id } });
    if (!message) throw new ValidationError("Message not found.");
    if (!CANCELABLE_STATUSES.has(message.status)) {
      throw new ValidationError("Only queued or retrying messages can be cancelled.");
    }

    const updated = await prisma.smsMessage.update({
      where: { id },
      data: { status: "FAILED", errorMessage: "Cancelled by admin." },
    });

    await createAuditEvent({
      organizationId: message.organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.message_cancelled",
      entityType: "SmsMessage",
      entityId: id,
    });

    return Response.json({ ok: true, data: updated });
  });
}
