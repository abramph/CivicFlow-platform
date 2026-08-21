import { prisma } from "@/lib/prisma";
import { sendReminderEmail, sendReceiptEmail } from "@/lib/mail";
import { createAuditEvent } from "@/lib/audit";
import { getSignedObjectUrl } from "@/lib/storage";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";

function buildReminderBody(log: {
  reminderType: string;
  subject: string | null;
  bodyPreview: string | null;
}) {
  return (
    log.bodyPreview ||
    `This is a Unestra reminder (${log.reminderType}). Please review your portal dashboard.`
  );
}

export async function processPendingReminderLogs(limit = 50) {
  const pending = await prisma.emailReminderLog.findMany({
    where: { status: "QUEUED" },
    include: { organization: true, member: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const log of pending) {
    try {
      // LAUNCH-BLOCKER subscription gate: a billing-inactive organization's
      // queued reminder is left untouched (still QUEUED, not deleted or
      // marked SKIPPED) so it becomes eligible again once access is
      // restored — the next cron run picks it up normally.
      const access = await resolveOrganizationAccess(log.organizationId);
      if (!access.allowed) continue;

      const recipient = log.recipientEmail || log.member?.email;
      if (!recipient) {
        await prisma.emailReminderLog.update({
          where: { id: log.id },
          data: { status: "SKIPPED", errorMessage: "No recipient email available" },
        });

        await createAuditEvent({
          organizationId: log.organizationId,
          actorUserId: log.createdByUserId,
          action: "update",
          entityType: "reminder_log",
          entityId: log.id,
          metadata: { status: "SKIPPED", reason: "missing_recipient" },
        });
        continue;
      }

      if (log.reminderType === "CONTRIBUTION_RECEIPT") {
        const latestReceipt = await prisma.contributionReceipt.findFirst({
          where: { organizationId: log.organizationId, memberId: log.memberId ?? undefined },
          orderBy: { createdAt: "desc" },
        });

        const maybeFileKey =
          latestReceipt && latestReceipt.metadata && typeof latestReceipt.metadata === "object"
            ? (latestReceipt.metadata as Record<string, unknown>).fileKey
            : undefined;

        const downloadUrl =
          typeof maybeFileKey === "string"
            ? await getSignedObjectUrl(maybeFileKey)
            : undefined;

        await sendReceiptEmail({
          to: recipient,
          receiptNumber: latestReceipt?.receiptNumber || "(pending)",
          amount: latestReceipt ? "See attached receipt" : "N/A",
          date: new Date().toISOString().slice(0, 10),
          downloadUrl,
        });
      } else {
        await sendReminderEmail({
          to: recipient,
          reminderType: log.reminderType,
          subject: log.subject || undefined,
          body: buildReminderBody(log),
        });
      }

      await prisma.emailReminderLog.update({
        where: { id: log.id },
        data: { status: "SENT", sentAt: new Date(), errorMessage: null },
      });

      await createAuditEvent({
        organizationId: log.organizationId,
        actorUserId: log.createdByUserId,
        action: "update",
        entityType: "reminder_log",
        entityId: log.id,
        metadata: { status: "SENT", reminderType: log.reminderType },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reminder send failed";
      await prisma.emailReminderLog.update({
        where: { id: log.id },
        data: { status: "FAILED", errorMessage: message },
      });

      await createAuditEvent({
        organizationId: log.organizationId,
        actorUserId: log.createdByUserId,
        action: "update",
        entityType: "reminder_log",
        entityId: log.id,
        metadata: { status: "FAILED", error: message },
      });
    }
  }

  return { processed: pending.length };
}
