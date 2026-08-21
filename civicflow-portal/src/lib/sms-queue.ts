import type { SmsMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/sms";
import { resolveOrganizationAccess } from "@/lib/subscription-gate";

const BATCH_SIZE = 50;

/**
 * One resend attempt — SENT or FAILED, no further requeueing. Shared by the
 * manual admin Retry action (api/admin/sms/messages/[id]/retry) and the
 * automated queue processor below, so there's exactly one implementation of
 * "what does a retry attempt actually do."
 *
 * LAUNCH-BLOCKER subscription gate: re-checked fresh on every call, in this
 * one shared place, so both the manual Retry button and the automated sweep
 * respect it identically — without this, a super-admin's manual Retry click
 * would bypass the gate entirely (it doesn't go through the automated
 * sweep's loop). Marked FAILED (not left RETRYING) so the sweep never
 * retries it forever and so it's visible in the admin SMS message list;
 * resuming it is then an explicit manual Retry click after the organization
 * resubscribes, never an automatic backlog blast.
 */
export async function attemptSmsMessageResend(
  message: Pick<SmsMessage, "id" | "phone" | "body" | "organizationId">
): Promise<SmsMessage> {
  const access = await resolveOrganizationAccess(message.organizationId);
  if (!access.allowed) {
    return prisma.smsMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", errorMessage: "Organization subscription is not active." },
    });
  }

  const result = await sendSms({ to: message.phone, body: message.body });
  return prisma.smsMessage.update({
    where: { id: message.id },
    data: result.sent
      ? { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId ?? null, errorMessage: null }
      : { status: "FAILED", errorMessage: result.reason ?? "Retry failed." },
  });
}

/**
 * Sweeps any message still sitting in RETRYING whose nextRetryAt has
 * passed — normally that's a manual retry interrupted mid-flight (e.g. a
 * server restart between marking RETRYING and resolving it), since the
 * manual Retry action itself resolves synchronously. Self-healing net, run
 * on a cron alongside the other worker/cron pairs in this codebase.
 */
export async function processRetryableSmsMessages(): Promise<{ processed: number }> {
  const due = await prisma.smsMessage.findMany({
    where: { status: "RETRYING", nextRetryAt: { lte: new Date() } },
    take: BATCH_SIZE,
  });

  for (const message of due) {
    await attemptSmsMessageResend(message);
  }

  return { processed: due.length };
}
