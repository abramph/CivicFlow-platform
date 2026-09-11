import { beforeEach, describe, expect, it, vi } from "vitest";

const createSmsMessage = vi.fn();
const findUniqueSmsMessage = vi.fn();
const findFirstSmsMessage = vi.fn();
const findFirstOrgMember = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      create: (...args: unknown[]) => createSmsMessage(...args),
      findUnique: (...args: unknown[]) => findUniqueSmsMessage(...args),
      findFirst: (...args: unknown[]) => findFirstSmsMessage(...args),
    },
    orgMember: {
      // authorizeSmsSend (REAL in this suite, running post-claim) uses a
      // tenant-scoped findFirst({ id, organizationId }) — never findUnique.
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
    },
  },
}));

const isSmsConfigured = vi.fn();
const sendSms = vi.fn();
vi.mock("@/lib/sms", () => ({
  isSmsConfigured: () => isSmsConfigured(),
  sendSms: (...args: unknown[]) => sendSms(...args),
}));

const getSmsEntitlement = vi.fn();
const reserveSmsAllowance = vi.fn();
vi.mock("@/lib/sms-entitlement", () => ({
  getSmsEntitlement: (...args: unknown[]) => getSmsEntitlement(...args),
  reserveSmsAllowance: (...args: unknown[]) => reserveSmsAllowance(...args),
}));

const claimInitialSmsAttempt = vi.fn();
const finalizeSmsAttemptSuccess = vi.fn();
const finalizeSmsAttemptFailure = vi.fn();
const finalizeSmsAttemptUnknown = vi.fn();
vi.mock("@/lib/sms-attempt-finalization", () => ({
  claimInitialSmsAttempt: (...args: unknown[]) => claimInitialSmsAttempt(...args),
  finalizeSmsAttemptSuccess: (...args: unknown[]) => finalizeSmsAttemptSuccess(...args),
  finalizeSmsAttemptFailure: (...args: unknown[]) => finalizeSmsAttemptFailure(...args),
  finalizeSmsAttemptUnknown: (...args: unknown[]) => finalizeSmsAttemptUnknown(...args),
}));

import { applySmsTemplateTokens, sendMemberSms } from "@/lib/sms-service";

// Period-bound reservation token as returned by reserveSmsAllowance — the
// failure finalizer must receive this exact token, never a bare org id.
const RESERVATION = {
  organizationId: "org-a",
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-01T00:00:00.000Z"),
} as const;

const CLAIM = { messageId: "sms-1", leaseExpiry: new Date("2026-09-10T00:02:00.000Z") } as const;
const CONSENTED = { smsOptIn: true, commsSmsEnabled: true, smsOptedOutAt: null };

function baseParams(overrides: Partial<Parameters<typeof sendMemberSms>[0]> = {}) {
  return {
    organizationId: "org-a",
    memberId: "member-1",
    phone: "+15551234567",
    body: "Test message",
    ...overrides,
  };
}

/**
 * Round-6 ordering: EVERY attempt (including ones that will be denied)
 * first creates the canonical QUEUED row and wins the initial claim; the
 * full canonical authorization runs AFTER ownership, immediately before
 * quota and the provider. Denials therefore finalize as truthful FAILED
 * rows under the fence, with zero reservations and zero Twilio calls.
 */
describe("sendMemberSms", () => {
  beforeEach(() => {
    createSmsMessage.mockReset();
    findUniqueSmsMessage.mockReset();
    findFirstSmsMessage.mockReset();
    findFirstOrgMember.mockReset();
    isSmsConfigured.mockReset().mockReturnValue(true);
    sendSms.mockReset();
    getSmsEntitlement.mockReset().mockResolvedValue({ allowed: true, remaining: 500, limit: 1000 });
    reserveSmsAllowance.mockReset().mockResolvedValue(RESERVATION);
    claimInitialSmsAttempt.mockReset().mockResolvedValue(CLAIM);
    finalizeSmsAttemptSuccess.mockReset().mockResolvedValue(true);
    finalizeSmsAttemptFailure.mockReset().mockResolvedValue(true);
    finalizeSmsAttemptUnknown.mockReset().mockResolvedValue(true);
    createSmsMessage.mockResolvedValue({ id: "sms-1", status: "QUEUED" });
    findUniqueSmsMessage.mockResolvedValue({ id: "sms-1", status: "FAILED" });
    findFirstOrgMember.mockResolvedValue(CONSENTED);
  });

  function expectDeniedWithoutSideEffects(reason: string) {
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledWith(CLAIM, null, reason);
    expect(reserveSmsAllowance).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptSuccess).not.toHaveBeenCalled();
  }

  it("POST-CLAIM authorization: 'SMS not configured' finalizes the claimed attempt FAILED — zero reservation, zero Twilio", async () => {
    isSmsConfigured.mockReturnValueOnce(false);

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    // The canonical row is created QUEUED and claimed BEFORE authorization.
    expect(createSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED" }) })
    );
    expect(claimInitialSmsAttempt.mock.invocationCallOrder[0]).toBeLessThan(isSmsConfigured.mock.invocationCallOrder[0]);
    expectDeniedWithoutSideEffects("SMS delivery is not configured.");
  });

  it("POST-CLAIM authorization: an org that lost the add-on moments earlier is denied after ownership — truthful FAILED attempt", async () => {
    getSmsEntitlement.mockResolvedValueOnce({ allowed: false, reason: "Your organization does not have the SMS add-on enabled.", remaining: 0, limit: 0 });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expectDeniedWithoutSideEffects("Your organization does not have the SMS add-on enabled.");
  });

  it("POST-CLAIM authorization: a member who opted out (STOP) before the post-claim check is denied — zero reservation, zero Twilio", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED, smsOptedOutAt: new Date() });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expectDeniedWithoutSideEffects("Member opted out of SMS.");
  });

  it("POST-CLAIM authorization: a member deleted/transferred before the post-claim check is denied", async () => {
    findFirstOrgMember.mockResolvedValueOnce(null);

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expectDeniedWithoutSideEffects("Recipient is no longer a member of this organization.");
  });

  it("does not call Twilio when the member has never opted in", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED, smsOptIn: false });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expectDeniedWithoutSideEffects("Member has not opted in to SMS.");
  });

  it("does not call Twilio when the preference toggle is off (non-required send)", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED, commsSmsEnabled: false });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expectDeniedWithoutSideEffects("Member has SMS notifications turned off.");
  });

  it("required=true bypasses the preference toggle but still requires real opt-in, and reserves before Twilio", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED, commsSmsEnabled: false });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, outcome: "sent", to: "+15551234567", providerMessageId: "SM1" });
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams({ required: true }));

    expect(result.status).toBe("SENT");
    expect(reserveSmsAllowance).toHaveBeenCalledWith("org-a");
  });

  it("required=true does NOT bypass a hard STOP opt-out", async () => {
    findFirstOrgMember.mockResolvedValueOnce({ ...CONSENTED, smsOptedOutAt: new Date() });

    const result = await sendMemberSms(baseParams({ required: true }));

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone number before calling Twilio (post-claim, truthful FAILED)", async () => {
    const result = await sendMemberSms(baseParams({ phone: "not-a-phone", memberId: null }));

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
    expect(reserveSmsAllowance).not.toHaveBeenCalled();
  });

  it("CONSENT BYPASS regression: a valid phone with memberId: null never reaches Twilio and reserves nothing", async () => {
    const result = await sendMemberSms(baseParams({ memberId: null }));

    expect(result.status).toBe("FAILED");
    expectDeniedWithoutSideEffects("Recipient consent cannot be verified for this message.");
    expect(findFirstOrgMember).not.toHaveBeenCalled();
  });

  it("stores the normalized number on the row (pure precheck) and sends to the post-claim authorization's normalized phone", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, outcome: "sent", to: "+12159174391" });
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams({ phone: "215-917-4391" }));

    expect(result.status).toBe("SENT");
    expect(createSmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "+12159174391" }) })
    );
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+12159174391" }));
  });

  it("CAMPAIGN IDEMPOTENCY: a unique-violation loser returns the existing canonical row and performs NO claim, authorization, reservation, or Twilio call", async () => {
    createSmsMessage.mockRejectedValueOnce({ code: "P2002" });
    findFirstSmsMessage.mockResolvedValueOnce({ id: "sms-existing", status: "SENT", providerMessageId: "SMwinner" });

    const result = await sendMemberSms(baseParams({ campaignId: "campaign-1" }));

    expect(result.id).toBe("sms-existing");
    expect(findFirstSmsMessage).toHaveBeenCalledWith({
      where: { organizationId: "org-a", campaignId: "campaign-1", memberId: "member-1" },
    });
    expect(claimInitialSmsAttempt).not.toHaveBeenCalled();
    expect(findFirstOrgMember).not.toHaveBeenCalled();
    expect(reserveSmsAllowance).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("CANCEL RACE: losing the QUEUED→SENDING claim (cancellation won) authorizes nothing, reserves nothing, and never calls Twilio", async () => {
    claimInitialSmsAttempt.mockResolvedValueOnce(null);
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "FAILED", errorMessage: "Cancelled by admin." });

    const result = await sendMemberSms(baseParams());

    expect(result.errorMessage).toBe("Cancelled by admin.");
    expect(findFirstOrgMember).not.toHaveBeenCalled(); // authorization never ran
    expect(reserveSmsAllowance).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("ORDER: claim → post-claim authorization → reservation → Twilio → one fenced success commit", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, outcome: "sent", to: "+15551234567", providerMessageId: "SM1" });
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("SENT");
    expect(claimInitialSmsAttempt.mock.invocationCallOrder[0]).toBeLessThan(findFirstOrgMember.mock.invocationCallOrder[0]);
    expect(findFirstOrgMember.mock.invocationCallOrder[0]).toBeLessThan(reserveSmsAllowance.mock.invocationCallOrder[0]);
    expect(reserveSmsAllowance.mock.invocationCallOrder[0]).toBeLessThan(sendSms.mock.invocationCallOrder[0]);
    expect(finalizeSmsAttemptSuccess).toHaveBeenCalledWith(CLAIM, {
      providerMessageId: "SM1",
      costEstimateCents: 2,
    });
    expect(finalizeSmsAttemptFailure).not.toHaveBeenCalled();
  });

  it("HARD STOP: a refused reservation finalizes FAILED with the allowance reason and never calls Twilio", async () => {
    reserveSmsAllowance.mockResolvedValueOnce(null);

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(sendSms).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledWith(
      CLAIM,
      null,
      "Your organization has used its full monthly SMS allowance."
    );
  });

  it("commits a DEFINITIVE Twilio failure exactly once, handing the reservation token to the failure finalizer (the only place that may release)", async () => {
    sendSms.mockResolvedValueOnce({ sent: false, skipped: false, outcome: "definitive_failure", to: "+15551234567", reason: "Twilio request failed (500)" });
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "FAILED", errorMessage: "Twilio request failed (500)" });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("FAILED");
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledTimes(1);
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledWith(CLAIM, RESERVATION, "Twilio request failed (500)");
    expect(finalizeSmsAttemptSuccess).not.toHaveBeenCalled();
  });

  it("AMBIGUOUS OUTCOME: a timeout/transport/no-valid-SID 'unknown' parks the attempt with the honest reason — no failure finalize, quota not released", async () => {
    sendSms.mockResolvedValueOnce({
      sent: false,
      skipped: false,
      outcome: "unknown",
      to: "+15551234567",
      reason: "Delivery outcome is unknown; verify in Twilio before retrying.",
    });
    findUniqueSmsMessage.mockResolvedValueOnce({
      id: "sms-1",
      status: "SENDING",
      nextRetryAt: null,
      errorMessage: "Delivery outcome is unknown; verify in Twilio before retrying.",
    });

    const result = await sendMemberSms(baseParams());

    expect(result.status).toBe("SENDING");
    expect(finalizeSmsAttemptUnknown).toHaveBeenCalledWith(CLAIM, "Delivery outcome is unknown; verify in Twilio before retrying.");
    expect(finalizeSmsAttemptFailure).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptSuccess).not.toHaveBeenCalled();
  });

  it("appends the opt-out compliance suffix to the message body", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, outcome: "sent", to: "+15551234567" });
    findUniqueSmsMessage.mockResolvedValueOnce({ id: "sms-1", status: "SENT" });

    await sendMemberSms(baseParams({ body: "Hello there" }));

    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining("Reply STOP to opt out.") }));
  });
});

describe("applySmsTemplateTokens", () => {
  it("substitutes organizationName and link tokens", () => {
    const result = applySmsTemplateTokens("Reminder: Your {organizationName} dues are due. Open Unestra: {link}", {
      organizationName: "ThrivePath Foundation",
      link: "https://app.getunestra.com/report-payment",
    });
    expect(result).toBe("Reminder: Your ThrivePath Foundation dues are due. Open Unestra: https://app.getunestra.com/report-payment");
  });

  it("substitutes an empty string when no link is provided", () => {
    const result = applySmsTemplateTokens("See {link} for details", { organizationName: "Org", link: null });
    expect(result).toBe("See  for details");
  });
});
