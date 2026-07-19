import { MeetingIntelligenceError } from "./errors";

/**
 * Meeting Intelligence MVP — pre-upload consent and privacy gate (Phase
 * 18). No legal assurance or compliance claim is made or implied anywhere
 * in this module — see docs/meeting-intelligence.md's privacy limitations
 * section. This is an internal APH pilot: do not use recordings containing
 * protected health information, psychotherapy content, patient identifiers,
 * highly sensitive personnel matters, confidential legal advice, payment
 * card data, or passwords/security credentials.
 */

export interface MeetingIntelligenceConsentConfirmation {
  participantsNotifiedOrConsented: boolean;
  uploaderAuthorized: boolean;
  mayContainSensitiveInformation: boolean;
  aiRequiresHumanVerification: boolean;
  organizationResponsibleForRetention: boolean;
}

export const CONSENT_STATEMENTS: Record<keyof MeetingIntelligenceConsentConfirmation, string> = {
  participantsNotifiedOrConsented: "Meeting participants were notified of recording, or consented, as required by your organization's policies and applicable law.",
  uploaderAuthorized: "I am authorized by my organization to process this recording.",
  mayContainSensitiveInformation: "I understand this recording may contain sensitive information and will be processed by third-party AI services for transcription and summarization.",
  aiRequiresHumanVerification: "I understand AI-generated minutes are a draft only and require human review and verification before being treated as official.",
  organizationResponsibleForRetention: "My organization is responsible for this recording's retention and any legal obligations related to it.",
};

/**
 * All five confirmations must be explicitly true — none default to true,
 * so a caller that forgets to collect one fails closed rather than
 * silently proceeding. Throws (rather than returning a boolean) so a
 * route can't accidentally ignore a missing confirmation.
 */
export function requireMeetingIntelligenceConsent(confirmation: MeetingIntelligenceConsentConfirmation): void {
  for (const [key, statement] of Object.entries(CONSENT_STATEMENTS) as Array<[keyof MeetingIntelligenceConsentConfirmation, string]>) {
    if (!confirmation[key]) {
      throw new MeetingIntelligenceError("MEETING_INTELLIGENCE_CONSENT_REQUIRED", `Consent confirmation required: ${statement}`);
    }
  }
}

export const SENSITIVE_CONTENT_WARNING =
  "Do not upload recordings containing protected health information, psychotherapy content, patient identifiers, highly sensitive personnel matters, confidential legal advice, payment card information, or passwords/security credentials. This is an internal technical pilot, not a compliance-certified system.";
