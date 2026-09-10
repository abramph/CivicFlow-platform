import { beforeEach, describe, expect, it, vi } from "vitest";

const findManySmsMessage = vi.fn();
const findUniqueSmsMessage = vi.fn();
const updateManySmsMessage = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: {
      findMany: (...args: unknown[]) => findManySmsMessage(...args),
      findUnique: (...args: unknown[]) => findUniqueSmsMessage(...args),
      updateMany: (...args: unknown[]) => updateManySmsMessage(...args),
    },
  },
}));

const sendSms = vi.fn();
vi.mock("@/lib/sms", async () => {
  const actual = await vi.importActual<typeof import("@/lib/sms")>("@/lib/sms");
  return { ...actual, sendSms: (...args: unknown[]) => sendSms(...args) };
});

const resolveOrganizationAccess = vi.fn();
vi.mock("@/lib/subscription-gate", () => ({
  resolveOrganizationAccess: (...args: unknown[]) => resolveOrganizationAccess(...args),
}));

const authorizeSmsSend = vi.fn();
vi.mock("@/lib/sms-send-authorization", () => ({
  authorizeSmsSend: (...args: unknown[]) => authorizeSmsSend(...args),
}));

const reserveSmsAllowance = vi.fn();
vi.mock("@/lib/sms-entitlement", () => ({
  reserveSmsAllowance: (...args: unknown[]) => reserveSmsAllowance(...args),
}));

const finalizeSmsAttemptSuccess = vi.fn();
const finalizeSmsAttemptFailure = vi.fn();
vi.mock("@/lib/sms-attempt-finalization", () => ({
  finalizeSmsAttemptSuccess: (...args: unknown[]) => finalizeSmsAttemptSuccess(...args),
  finalizeSmsAttemptFailure: (...args: unknown[]) => finalizeSmsAttemptFailure(...args),
}));

const ALLOWED = { allowed: true, reason: null, trialEndsAt: null, subscriptionStatus: null, billingExempt: false } as const;
const AUTHORIZED = { allowed: true, normalizedPhone: "+15551234567" } as const;
const RESERVATION = {
  organizationId: "org-a",
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-01T00:00:00.000Z"),
} as const;

const ROW = { id: "msg-1", organizationId: "org-a", memberId: "member-1", phone: "+15551234567", body: "hi", status: "SENDING" };

import { TWILIO_REQUEST_TIMEOUT_MS } from "@/lib/sms";
import {
  SMS_RETRY_LEASE_MS,
  claimSmsRetryAttempt,
  executeClaimedSmsRetry,
  processRetryableSmsMessages,
} from "@/lib/sms-queue";

describe("lease vs Twilio timeout invariant", () => {
  it("the retry lease comfortably outlives the Twilio HTTP timeout (a hung Twilio call must never lose its lease mid-flight)", () => {
    expect(TWILIO_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(SMS_RETRY_LEASE_MS).toBe(120_000);
    expect(SMS_RETRY_LEASE_MS).toBeGreaterThanOrEqual(TWILIO_REQUEST_TIMEOUT_MS * 4);
  });
});

describe("claimSmsRetryAttempt", () => {
  beforeEach(() => {
    updateManySmsMessage.mockReset();
  });

  it("wins ownership via one CAS: eligible RETRYING or lease-expired SENDING rows move to SENDING with a fresh lease and ONE retryCount increment", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    const before = Date.now();

    const lease = await claimSmsRetryAttempt("msg-1");

    expect(lease).not.toBeNull();
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: { in: ["RETRYING", "SENDING"] }, nextRetryAt: { lte: expect.any(Date) } },
      data: { status: "SENDING", nextRetryAt: lease!.leaseExpiry, retryCount: { increment: 1 } },
    });
    const expiryMs = lease!.leaseExpiry.getTime() - before;
    expect(expiryMs).toBeGreaterThanOrEqual(SMS_RETRY_LEASE_MS - 1000);
    expect(expiryMs).toBeLessThanOrEqual(SMS_RETRY_LEASE_MS + 1000);
  });

  it("returns null when another worker owns the row (CAS matched zero rows)", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });
    await expect(claimSmsRetryAttempt("msg-1")).resolves.toBeNull();
  });
});

describe("executeClaimedSmsRetry", () => {
  beforeEach(() => {
    updateManySmsMessage.mockReset();
    findUniqueSmsMessage.mockReset();
    sendSms.mockReset();
    resolveOrganizationAccess.mockReset().mockResolvedValue(ALLOWED);
    authorizeSmsSend.mockReset().mockResolvedValue(AUTHORIZED);
    reserveSmsAllowance.mockReset().mockResolvedValue(RESERVATION);
    finalizeSmsAttemptSuccess.mockReset().mockResolvedValue(true);
    finalizeSmsAttemptFailure.mockReset().mockResolvedValue(true);
    updateManySmsMessage.mockResolvedValue({ count: 1 }); // claim wins by default
    findUniqueSmsMessage.mockResolvedValue(ROW);
  });

  it("SINGLE OWNER: a lost claim does nothing at all — no read, no authorization, no reservation, no Twilio, no finalize", async () => {
    updateManySmsMessage.mockReset().mockResolvedValueOnce({ count: 0 });

    const result = await executeClaimedSmsRetry("msg-1");

    expect(result).toEqual({ claimed: false });
    expect(findUniqueSmsMessage).not.toHaveBeenCalled();
    expect(authorizeSmsSend).not.toHaveBeenCalled();
    expect(reserveSmsAllowance).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptSuccess).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptFailure).not.toHaveBeenCalled();
  });

  it("a won claim executes in order — ownership, gates, reservation immediately before Twilio, one fenced success commit", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567", providerMessageId: "SM1" });
    findUniqueSmsMessage.mockResolvedValue({ ...ROW, status: "SENT" });

    const result = await executeClaimedSmsRetry("msg-1");

    expect(result.claimed).toBe(true);
    // authorization happens only after the worker owns the attempt
    expect(updateManySmsMessage.mock.invocationCallOrder[0]).toBeLessThan(authorizeSmsSend.mock.invocationCallOrder[0]);
    expect(reserveSmsAllowance.mock.invocationCallOrder[0]).toBeLessThan(sendSms.mock.invocationCallOrder[0]);
    expect(finalizeSmsAttemptSuccess).toHaveBeenCalledWith(
      { kind: "retry", messageId: "msg-1", leaseExpiry: expect.any(Date) },
      { providerMessageId: "SM1" }
    );
    expect(finalizeSmsAttemptFailure).not.toHaveBeenCalled();
  });

  it("LAUNCH-BLOCKER: a billing-inactive org finalizes FAILED (no allowance involved) without authorization or Twilio", async () => {
    resolveOrganizationAccess.mockResolvedValueOnce({ allowed: false, reason: "TRIAL_EXPIRED", trialEndsAt: null, subscriptionStatus: null, billingExempt: false });

    const result = await executeClaimedSmsRetry("msg-1");

    expect(result.claimed).toBe(true);
    expect(authorizeSmsSend).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "retry", messageId: "msg-1" }),
      null,
      "Organization subscription is not active."
    );
  });

  it("COMPLIANCE: an authorization denial (STOP, revoked add-on, removed member) finalizes FAILED with the canonical reason — no reservation, no Twilio", async () => {
    authorizeSmsSend.mockResolvedValueOnce({ allowed: false, reason: "Member opted out of SMS." });

    await executeClaimedSmsRetry("msg-1");

    expect(reserveSmsAllowance).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledWith(expect.anything(), null, "Member opted out of SMS.");
  });

  it("passes required:false and the row's own memberId to the canonical authorization", async () => {
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+15551234567" });

    await executeClaimedSmsRetry("msg-1");

    expect(authorizeSmsSend).toHaveBeenCalledWith({
      organizationId: "org-a",
      memberId: "member-1",
      phone: "+15551234567",
      required: false,
    });
  });

  it("HARD STOP: a refused reservation finalizes FAILED with the allowance reason and never calls Twilio", async () => {
    reserveSmsAllowance.mockResolvedValueOnce(null);

    await executeClaimedSmsRetry("msg-1");

    expect(sendSms).not.toHaveBeenCalled();
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledWith(
      expect.anything(),
      null,
      "Your organization has used its full monthly SMS allowance."
    );
  });

  it("a synchronous Twilio failure finalizes FAILED once WITH the reservation token, so the single winning transition releases the unit", async () => {
    sendSms.mockResolvedValueOnce({ sent: false, skipped: false, to: "+15551234567", reason: "carrier rejected" });

    await executeClaimedSmsRetry("msg-1");

    expect(finalizeSmsAttemptFailure).toHaveBeenCalledTimes(1);
    expect(finalizeSmsAttemptFailure).toHaveBeenCalledWith(expect.anything(), RESERVATION, "carrier rejected");
    expect(finalizeSmsAttemptSuccess).not.toHaveBeenCalled();
  });

  it("sends to the freshly normalized phone from the authorization, not the raw stored value", async () => {
    authorizeSmsSend.mockResolvedValueOnce({ allowed: true, normalizedPhone: "+12159174391" });
    sendSms.mockResolvedValueOnce({ sent: true, skipped: false, to: "+12159174391" });

    await executeClaimedSmsRetry("msg-1");

    expect(sendSms).toHaveBeenCalledWith({ to: "+12159174391", body: "hi" });
  });
});

describe("processRetryableSmsMessages", () => {
  beforeEach(() => {
    findManySmsMessage.mockReset();
    findUniqueSmsMessage.mockReset().mockResolvedValue(ROW);
    updateManySmsMessage.mockReset();
    sendSms.mockReset();
    resolveOrganizationAccess.mockReset().mockResolvedValue(ALLOWED);
    authorizeSmsSend.mockReset().mockResolvedValue(AUTHORIZED);
    reserveSmsAllowance.mockReset().mockResolvedValue(RESERVATION);
    finalizeSmsAttemptSuccess.mockReset().mockResolvedValue(true);
    finalizeSmsAttemptFailure.mockReset().mockResolvedValue(true);
  });

  it("sweeps eligible RETRYING rows AND lease-expired SENDING rows (crash recovery), claiming each atomically", async () => {
    findManySmsMessage.mockResolvedValueOnce([{ id: "msg-1" }, { id: "msg-2" }]);
    updateManySmsMessage.mockResolvedValue({ count: 1 });
    sendSms.mockResolvedValue({ sent: true, skipped: false, to: "x", providerMessageId: "SM1" });

    const result = await processRetryableSmsMessages();

    expect(findManySmsMessage).toHaveBeenCalledWith({
      where: { status: { in: ["RETRYING", "SENDING"] }, nextRetryAt: { lte: expect.any(Date) } },
      take: 50,
      select: { id: true },
    });
    expect(result.processed).toBe(2);
    expect(sendSms).toHaveBeenCalledTimes(2);
  });

  it("OVERLAPPING SWEEPS: a sweep whose per-row claims all lose (another worker owns them) sends nothing and reports zero processed", async () => {
    findManySmsMessage.mockResolvedValueOnce([{ id: "msg-1" }, { id: "msg-2" }]);
    updateManySmsMessage.mockResolvedValue({ count: 0 });

    const result = await processRetryableSmsMessages();

    expect(result.processed).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
    expect(reserveSmsAllowance).not.toHaveBeenCalled();
  });

  it("returns processed: 0 when nothing is due", async () => {
    findManySmsMessage.mockResolvedValueOnce([]);
    const result = await processRetryableSmsMessages();
    expect(result.processed).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
