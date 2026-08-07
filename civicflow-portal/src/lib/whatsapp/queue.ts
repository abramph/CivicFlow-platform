import type { WhatsAppMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { ValidationError } from "@/lib/validation";

/**
 * Resends a FAILED WhatsApp message, mirroring attemptSmsMessageResend()
 * (src/lib/sms-queue.ts). Only freeform/Sandbox sends (a literal `body`) can
 * be retried — an approved-template send never has its Content SID or the
 * variables used for that specific send stored on the row by design
 * (WhatsAppMessage.body is null for template sends; see the model's own
 * schema comment — Twilio/Meta renders the text server-side, so no literal
 * copy is ever held), so there is nothing to literally resend. Callers must
 * check `message.body !== null` before calling this — see the admin retry
 * route for the resulting user-facing error.
 */
export async function attemptWhatsAppMessageResend(
  message: Pick<WhatsAppMessage, "id" | "phone" | "body">
): Promise<WhatsAppMessage> {
  if (message.body === null) {
    throw new ValidationError(
      "This message used an approved template — no stored content to resend. Ask the sender to retry from the original campaign or flow."
    );
  }

  const result = await sendWhatsAppMessage({ to: message.phone, body: message.body });
  return prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: result.sent
      ? { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId ?? null, errorMessage: null }
      : { status: "FAILED", errorMessage: result.reason ?? "Retry failed." },
  });
}
