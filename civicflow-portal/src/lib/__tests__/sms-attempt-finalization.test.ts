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

import { finalizeSmsAttemptFailure, finalizeSmsAttemptSuccess } from "@/lib/sms-attempt-finalization";

const RESERVATION = {
  organizationId: "org-a",
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-01T00:00:00.000Z"),
};

const INITIAL_CLAIM = { kind: "initial", messageId: "msg-1" } as const;
const LEASE = new Date("2026-09-10T00:02:00.000Z");
const RETRY_CLAIM = { kind: "retry", messageId: "msg-1", leaseExpiry: LEASE } as const;

describe("finalizeSmsAttemptSuccess", () => {
  beforeEach(() => {
    updateManySmsMessage.mockReset();
  });

  it("commits an initial-send success only through the QUEUED in-flight state", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });

    const ok = await finalizeSmsAttemptSuccess(INITIAL_CLAIM, { providerMessageId: "SM1", costEstimateCents: 2 });

    expect(ok).toBe(true);
    expect(updateManySmsMessage).toHaveBeenCalledWith({
      where: { id: "msg-1", status: "QUEUED" },
      data: expect.objectContaining({
        status: "SENT",
        providerMessageId: "SM1",
        costEstimateCents: 2,
        nextRetryAt: null,
      }),
    });
  });

  it("commits a retry success only under the exact lease fence (status SENDING + this worker's lease value)", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 1 });

    const ok = await finalizeSmsAttemptSuccess(RETRY_CLAIM, { providerMessageId: "SM2" });

    expect(ok).toBe(true);
    expect(updateManySmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "msg-1", status: "SENDING", nextRetryAt: LEASE } })
    );
  });

  it("returns false and overwrites nothing when the in-flight state is gone (recovered, cancelled, or webhook-terminalized)", async () => {
    updateManySmsMessage.mockResolvedValueOnce({ count: 0 });
    const ok = await finalizeSmsAttemptSuccess(RETRY_CLAIM, { providerMessageId: "SM2" });
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

    const ok = await finalizeSmsAttemptFailure(RETRY_CLAIM, RESERVATION, "carrier rejected");

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

    const ok = await finalizeSmsAttemptFailure(RETRY_CLAIM, RESERVATION, "carrier rejected");

    expect(ok).toBe(false);
    expect(txExecuteRaw).not.toHaveBeenCalled();
  });

  it("a failure that never reserved (reservation: null) finalizes without touching the allowance", async () => {
    txUpdateManySmsMessage.mockResolvedValueOnce({ count: 1 });

    const ok = await finalizeSmsAttemptFailure(INITIAL_CLAIM, null, "Member opted out of SMS.");

    expect(ok).toBe(true);
    expect(txUpdateManySmsMessage).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "msg-1", status: "QUEUED" } })
    );
    expect(txExecuteRaw).not.toHaveBeenCalled();
  });
});
