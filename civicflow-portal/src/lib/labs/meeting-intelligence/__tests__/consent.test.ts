import { describe, expect, it } from "vitest";
import { requireMeetingIntelligenceConsent } from "../consent";

const fullConsent = {
  participantsNotifiedOrConsented: true,
  uploaderAuthorized: true,
  mayContainSensitiveInformation: true,
  aiRequiresHumanVerification: true,
  organizationResponsibleForRetention: true,
};

describe("requireMeetingIntelligenceConsent", () => {
  it("passes silently when every confirmation is true", () => {
    expect(() => requireMeetingIntelligenceConsent(fullConsent)).not.toThrow();
  });

  it.each(Object.keys(fullConsent))("fails closed when %s is false", (key) => {
    expect(() => requireMeetingIntelligenceConsent({ ...fullConsent, [key]: false })).toThrow(
      expect.objectContaining({ code: "MEETING_INTELLIGENCE_CONSENT_REQUIRED" })
    );
  });
});
