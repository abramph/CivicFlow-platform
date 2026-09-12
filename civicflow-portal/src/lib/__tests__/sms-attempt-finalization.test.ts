import { beforeEach, describe, expect, it, vi } from "vitest";

const updateManySmsMessage = vi.fn();
const txUpdateManySmsMessage = vi.fn();
const txExecuteRaw = vi.fn();

// $transaction runs its callback against a tx client whose calls are
// tracked separately, so these tests can prove the release rides the SAME
// transaction as the FAILED transition.
const tx = {
  smsMessage: { updateMany: (...args: unknown[]) => txUpdateManySmsMessage(...args) },
  $executeRaw: (...args: unknown[]) => txExecuteRaw(...args),
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    smsMessage: { updateMany: (...args: unknown[]) => updateManySmsMessage(...args) },
    $transaction: (fn: (t: unknown) => unknown) => fn(tx),
  },
}));

import {
  SMS_ATTEMPT_LEASE_MS,
  claimInitialSmsAttempt,
  finalizeSmsAttemptFailure,
  finalizeSmsAttemptSuccess,
  finalizeSmsAttemptUnknown,
} from "@/lib/sms-attempt-finalization";

const RESERVATION = {
  organizationId: "org-a",
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-01T00:00:00.000Z"),
};

const LEASE = new Date("2026-09-10T00:02:00.000Z");
const CLAIM = { messageId: "msg-1", leaseExpiry: LEASE } as const;

describe("claimInitialSmsAttempt", () => {
  beforeEach(() => {
    updateManySmsMessage.mockReset();
  });

  it("atomically claims QUEUED → SENDING with a lease, WITHOUT touching retryCount (the original attempt is attempt zero)", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    const before = Date.now();

    const claim = await claimInitialSmsAttempt("msg-1");

    expect(claim).not.toBeNull();
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: "QUEUED" },
      data: { status: "SENDING", nextRetryAt: claim!.leaseExpiry },
    });
    expect(updateManySmsMessage.mock.calls[0][0].data).not.toHaveProperty("retryCount");
    const expiryMs = claim!.leaseExpiry.getTime() - before;
    expect(expiryMs).toBeGreaterThanOrEqual(SMS_ATTEMPT_LEASE_MS - 1000);
    expect(expiryMs).toBeLessThanOrEqual(SMS_ATTEMPT_LEASE_MS + 1000);
  });

  it("returns null when the QUEUED state is gone — cancellation won, so the caller must not reserve or send", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });
    await expect(claimInitialSmsAttempt("msg-1")).resolves.toBeNull();
  });
});

describe("finalizeSmsAttemptSuccess", () => {
  beforeEach(() => {
    updateManySmsMessage.mockReset();
  });

  it("commits success only under the unified fence (status SENDING + this worker's exact lease value)", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });

    const ok = await finalizeSmsAttemptSuccess(CLAIM, { providerMessageId: "SM1", costEstimateCents: 2 });

    expect(ok).toBe(true);
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: "SENDING", nextRetryAt: LEASE },
      data: expect.objectContaining({
        status: "SENT",
        providerMessageId: "SM1",
        costEstimateCents: 2,
        nextRetryAt: null,
      }),
    });
  });

  it("returns false and overwrites nothing when the in-flight state is gone (recovered, cancelled, or webhook-terminalized)", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });
    const ok = await finalizeSmsAttemptSuccess(CLAIM, { providerMessageId: "SM2" });
    expect(ok).toBe(false);
  });
});

describe("finalizeSmsAttemptFailure", () => {
  beforeEach(() => {
    txUpdateManySmsMessage.mockReset();
    txExecuteRaw.mockReset();
  });

  it("releases the reserved unit EXACTLY when its own FAILED transition wins, inside the same transaction", async () => {
    txUpdateManySmsMessage.mockResolvedValueOnce({ count: 1 });
    txExecuteRaw.mockResolvedValueOnce(1);

    const ok = await finalizeSmsAttemptFailure(CLAIM, RESERVATION, "carrier rejected");

    expect(ok).toBe(true);
    expect(txUpdateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: "SENDING", nextRetryAt: LEASE },
      data: { status: "FAILED", errorMessage: "carrier rejected", nextRetryAt: null },
    });
    // The release ran on the SAME tx client, with the period-bound token.
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(txExecuteRaw.mock.calls[0].slice(1)).toEqual([
      "org-a",
      BigInt(RESERVATION.periodStart.getTime()),
      BigInt(RESERVATION.periodEnd.getTime()),
    ]);
  });

  it("a duplicate or stale finalizer (transition matches zero rows) releases NOTHING", async () => {
    txUpdateManySmsMessage.mockResolvedValueOnce({ count: 0 });

    const ok = await finalizeSmsAttemptFailure(CLAIM, RESERVATION, "carrier rejected");

    expect(ok).toBe(false);
    expect(txExecuteRaw).not.toHaveBeenCalled();
  });

  it("a failure that never reserved (reservation: null) finalizes without touching the allowance", async () => {
    txUpdateManySmsMessage.mockResolvedValueOnce({ count: 1 });

    const ok = await finalizeSmsAttemptFailure(CLAIM, null, "Member opted out of SMS.");

    expect(ok).toBe(true);
    expect(txExecuteRaw).not.toHaveBeenCalled();
  });
});

describe("finalizeSmsAttemptUnknown", () => {
  beforeEach(() => {
    updateManySmsMessage.mockReset();
  });

  it("parks the attempt under the fence: status stays SENDING, the lease is cleared, the honest reason is recorded, and NO release occurs", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });

    const ok = await finalizeSmsAttemptUnknown(CLAIM, "Delivery outcome is unknown; verify in Twilio before retrying.");

    expect(ok).toBe(true);
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: "SENDING", nextRetryAt: LEASE },
      data: { errorMessage: "Delivery outcome is unknown; verify in Twilio before retrying.", nextRetryAt: null },
    });
    // No status change, no transaction, no release path at all.
    expect(updateManySmsMessage.mock.calls[0][0].data).not.toHaveProperty("status");
  });

  it("a stale worker's unknown-parking matches zero rows and does nothing", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });
    await expect(finalizeSmsAttemptUnknown(CLAIM, "x")).resolves.toBe(false);
  });
});
