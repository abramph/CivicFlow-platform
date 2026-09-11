import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * POST: cancels a message still in the queue, marking it FAILED without
 * attempting a send. Round 5: the cancel is a single compare-and-set —
 * it wins ONLY while the database row is still QUEUED or RETRYING. If a
 * send worker already claimed the row (QUEUED/RETRYING → SENDING), the
 * external send has begun (or its outcome is unknown) and cancellation is
 * truthfully rejected with a conflict instead of marking a possibly
 * delivered message "cancelled". A cancellation loser changes nothing:
 * no status write, no lease clear, no quota effect — and no audit event;
 * exactly one of any number of concurrent Cancel requests can win the CAS,
 * and only that winner audits. Clearing nextRetryAt removes a RETRYING
 * row's eligibility so the sweep can never resurrect a cancelled message.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const { id } = await params;

    const message = await prisma.smsMessage.findUnique({ where: { id } });
    if (!message) throw new ValidationError("Message not found.");

    const cancelled = await prisma.smsMessage.updateMany({
      where: { id, status: { in: ["QUEUED", "RETRYING"] } },
      data: { status: "FAILED", errorMessage: "Cancelled by admin.", nextRetryAt: null },
    });

    if (cancelled.count === 0) {
      const fresh = await prisma.smsMessage.findUnique({ where: { id } });
      if (fresh?.status === "SENDING") {
        throw new ValidationError("Message is already being sent (or its delivery outcome is unknown) and can no longer be cancelled.");
      }
      throw new ValidationError("Only queued or retrying messages can be cancelled.");
    }

    await createAuditEvent({
      organizationId: message.organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.message_cancelled",
      entityType: "SmsMessage",
      entityId: id,
    });

    const updated = await prisma.smsMessage.findUnique({ where: { id } });
    return Response.json({ ok: true, data: updated });
  });
}
