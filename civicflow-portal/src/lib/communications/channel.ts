import { sendEmail } from "@/lib/mail";
import { sendPushToTokens, type PushNotificationInput } from "@/lib/push";
import { sendMemberSms, type SendMemberSmsParams } from "@/lib/sms-service";
import { sendMemberWhatsApp, type SendMemberWhatsAppParams } from "@/lib/whatsapp/whatsapp-service";

export type ChannelKey = "EMAIL" | "SMS" | "PUSH" | "WHATSAPP";
export type ChannelSendStatus = "SENT" | "SKIPPED" | "FAILED";

export interface ChannelSendResult {
  status: ChannelSendStatus;
  errorMessage?: string | null;
  providerMessageId?: string | null;
}

/**
 * Common shape every communication channel normalizes its send result to.
 * Each channel's send() still takes its own channel-specific params (an
 * email needs a subject/body; WhatsApp needs a template-or-freeform body) —
 * this interface standardizes the *calling convention and result shape*, not
 * a lossy shared parameter type.
 *
 * Introduced so PR B's campaign dispatcher can loop over enabled channels
 * instead of communication-campaigns.ts's current hardcoded if/else per
 * channel. Not yet consumed anywhere in PR A — each adapter below wraps an
 * existing, unmodified send function; production behavior is unchanged.
 */
export interface CommunicationChannel<TSendParams> {
  readonly key: ChannelKey;
  send(params: TSendParams): Promise<ChannelSendResult>;
}

export interface EmailSendParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export const EmailChannel: CommunicationChannel<EmailSendParams> = {
  key: "EMAIL",
  async send(params) {
    const result = await sendEmail(params);
    return {
      status: result.sent ? "SENT" : "SKIPPED",
      errorMessage: result.skipped ? (result.reason ?? "Email sending skipped") : null,
    };
  },
};

export const SmsChannel: CommunicationChannel<SendMemberSmsParams> = {
  key: "SMS",
  async send(params) {
    // sendMemberSms() always resolves to a terminal SENT or FAILED row —
    // same never-throws contract as sendMemberWhatsApp() above.
    const message = await sendMemberSms(params);
    return {
      status: message.status === "FAILED" ? "FAILED" : "SENT",
      errorMessage: message.errorMessage,
      providerMessageId: message.providerMessageId,
    };
  },
};

export interface PushSendParams {
  tokens: string[];
  notification: PushNotificationInput;
}

export const PushChannel: CommunicationChannel<PushSendParams> = {
  key: "PUSH",
  async send({ tokens, notification }) {
    if (tokens.length === 0) {
      return { status: "SKIPPED", errorMessage: "No registered devices" };
    }
    const result = await sendPushToTokens(tokens, notification);
    return result.sent > 0
      ? { status: "SENT" }
      : { status: "FAILED", errorMessage: "Delivery failed" };
  },
};

export const WhatsAppChannel: CommunicationChannel<SendMemberWhatsAppParams> = {
  key: "WHATSAPP",
  async send(params) {
    // sendMemberWhatsApp() always resolves to a terminal SENT or FAILED row
    // — every pre-flight failure (unconfigured, no entitlement, not opted
    // in, invalid phone) is captured as FAILED, same contract as
    // sendMemberSms(). There is no QUEUED-at-return-time case to handle here.
    const message = await sendMemberWhatsApp(params);
    return {
      status: message.status === "FAILED" ? "FAILED" : "SENT",
      errorMessage: message.errorMessage,
      providerMessageId: message.providerMessageId,
    };
  },
};
