import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
const create = vi.fn().mockResolvedValue({});
const findUnique = vi.fn();
const updateMany = vi.fn();
const transaction = vi.fn((ops: unknown[]) => Promise.all(ops));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHouseholdAdultInvite: {
      deleteMany: (...args: unknown[]) => deleteMany(...args),
      create: (...args: unknown[]) => create(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}));

vi.mock("@/lib/mail", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/env", () => ({ getMobileAppWebBaseUrl: () => "https://app.example.test" }));

import {
  consumePtaHouseholdAdultInvite,
  createPtaHouseholdAdultInvite,
} from "@/lib/labs/pta/household-adult-invites";

describe("createPtaHouseholdAdultInvite", () => {
  beforeEach(() => {
    deleteMany.mockReset().mockResolvedValue({ count: 0 });
    create.mockReset().mockResolvedValue({});
    transaction.mockClear();
  });

  it("clears any prior unaccepted invite for the same adult before creating a new one", async () => {
    await createPtaHouseholdAdultInvite({ organizationId: "org-a", householdAdultId: "adult-1" });

    expect(deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-a", householdAdultId: "adult-1", acceptedAt: null },
    });
    expect(create).toHaveBeenCalled();
  });

  it("runs the clear-then-create as a single transaction, so two concurrent invite requests can never both leave a live token behind", async () => {
    await createPtaHouseholdAdultInvite({ organizationId: "org-a", householdAdultId: "adult-1" });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("returns a raw token distinct from what gets persisted (only the hash is stored)", async () => {
    const token = await createPtaHouseholdAdultInvite({ organizationId: "org-a", householdAdultId: "adult-1" });
    const persisted = create.mock.calls[0][0].data.tokenHash;

    expect(token).toHaveLength(64); // 32 bytes hex
    expect(persisted).not.toBe(token);
  });
});

describe("consumePtaHouseholdAdultInvite", () => {
  beforeEach(() => {
    findUnique.mockReset();
    updateMany.mockReset();
  });

  it("rejects an unknown token", async () => {
    findUnique.mockResolvedValueOnce(null);

    const result = await consumePtaHouseholdAdultInvite("bad-token");

    expect(result.ok).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects an already-accepted invite", async () => {
    findUnique.mockResolvedValueOnce({
      id: "invite-1",
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 100_000),
      organizationId: "org-a",
      householdAdultId: "adult-1",
    });

    const result = await consumePtaHouseholdAdultInvite("used-token");

    expect(result.ok).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects an expired invite", async () => {
    findUnique.mockResolvedValueOnce({
      id: "invite-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 1),
      organizationId: "org-a",
      householdAdultId: "adult-1",
    });

    const result = await consumePtaHouseholdAdultInvite("expired-token");

    expect(result.ok).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("atomically claims a valid invite via a conditional update, not a separate read-then-write", async () => {
    findUnique.mockResolvedValueOnce({
      id: "invite-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 100_000),
      organizationId: "org-a",
      householdAdultId: "adult-1",
    });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await consumePtaHouseholdAdultInvite("good-token");

    expect(result).toEqual({ ok: true, organizationId: "org-a", householdAdultId: "adult-1", inviteId: "invite-1" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "invite-1", acceptedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { acceptedAt: expect.any(Date) },
    });
  });

  it("rejects when a concurrent request already claimed the same token (updateMany affected zero rows)", async () => {
    findUnique.mockResolvedValueOnce({
      id: "invite-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 100_000),
      organizationId: "org-a",
      householdAdultId: "adult-1",
    });
    updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await consumePtaHouseholdAdultInvite("raced-token");

    expect(result.ok).toBe(false);
  });
});
