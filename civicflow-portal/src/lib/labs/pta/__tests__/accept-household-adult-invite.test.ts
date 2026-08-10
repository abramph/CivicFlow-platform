import { beforeEach, describe, expect, it, vi } from "vitest";

const consumePtaHouseholdAdultInvite = vi.fn();
vi.mock("@/lib/labs/pta/household-adult-invites", () => ({
  consumePtaHouseholdAdultInvite: (...args: unknown[]) => consumePtaHouseholdAdultInvite(...args),
}));

const findFirstAdult = vi.fn();
const updateAdult = vi.fn().mockResolvedValue({});
const findUniqueUser = vi.fn();
const createUser = vi.fn();
const createAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHouseholdAdult: {
      findFirst: (...args: unknown[]) => findFirstAdult(...args),
      update: (...args: unknown[]) => updateAdult(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
      create: (...args: unknown[]) => createUser(...args),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

import bcrypt from "bcryptjs";
import { acceptPtaHouseholdAdultInvite } from "@/lib/labs/pta/accept-household-adult-invite";

describe("acceptPtaHouseholdAdultInvite", () => {
  beforeEach(() => {
    consumePtaHouseholdAdultInvite.mockReset();
    findFirstAdult.mockReset();
    updateAdult.mockReset().mockResolvedValue({});
    findUniqueUser.mockReset();
    createUser.mockReset();
    createAuditEvent.mockReset().mockResolvedValue(undefined);

    consumePtaHouseholdAdultInvite.mockResolvedValue({
      ok: true,
      organizationId: "org-a",
      householdAdultId: "adult-1",
      inviteId: "invite-1",
    });
    findFirstAdult.mockResolvedValue({
      id: "adult-1",
      name: "Jordan Lee",
      email: "jordan@example.com",
      userId: null,
    });
  });

  it("creates a new user when no account exists for the email, and links the adult", async () => {
    findUniqueUser.mockResolvedValueOnce(null);
    createUser.mockResolvedValueOnce({ id: "user-new", email: "jordan@example.com", displayName: "Jordan Lee", mobileTokenVersion: 0 });

    const result = await acceptPtaHouseholdAdultInvite("raw-token", "a-strong-password");

    expect(result.ok).toBe(true);
    expect(createUser).toHaveBeenCalled();
    expect(updateAdult).toHaveBeenCalledWith({ where: { id: "adult-1" }, data: { userId: "user-new" } });
    // Never creates or touches an OrganizationMembership or OrgMember row —
    // a pure household-adult login is resolved entirely from
    // PtaHouseholdAdult.userId (see org-context.ts's synthetic-entry doc
    // comment); this flow has no reason to create one.
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "pta.household_adult.invite_accepted" }));
  });

  it("links to an existing account when the submitted password matches it", async () => {
    const passwordHash = await bcrypt.hash("real-password", 12);
    findUniqueUser.mockResolvedValueOnce({ id: "user-existing", email: "jordan@example.com", displayName: "Jordan", passwordHash, mobileTokenVersion: 0 });

    const result = await acceptPtaHouseholdAdultInvite("raw-token", "real-password");

    expect(result.ok).toBe(true);
    expect(createUser).not.toHaveBeenCalled();
    expect(updateAdult).toHaveBeenCalledWith({ where: { id: "adult-1" }, data: { userId: "user-existing" } });
  });

  it("rejects linking to an existing account when the submitted password does not match — holding the invite email is not proof of account ownership", async () => {
    const passwordHash = await bcrypt.hash("real-password", 12);
    findUniqueUser.mockResolvedValueOnce({ id: "user-existing", email: "jordan@example.com", displayName: "Jordan", passwordHash, mobileTokenVersion: 0 });

    const result = await acceptPtaHouseholdAdultInvite("raw-token", "some-guessed-password");

    expect(result.ok).toBe(false);
    expect(updateAdult).not.toHaveBeenCalled();
  });

  it("rejects an adult already linked to a user — guards duplicate/overwrite linkage", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", name: "Jordan Lee", email: "jordan@example.com", userId: "already-linked-user" });

    const result = await acceptPtaHouseholdAdultInvite("raw-token", "a-strong-password");

    expect(result.ok).toBe(false);
    expect(updateAdult).not.toHaveBeenCalled();
  });

  it("rejects an adult with no email on file", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "adult-1", name: "Jordan Lee", email: null, userId: null });

    const result = await acceptPtaHouseholdAdultInvite("raw-token", "a-strong-password");

    expect(result.ok).toBe(false);
    expect(updateAdult).not.toHaveBeenCalled();
  });

  it("propagates an invalid/expired/already-used token without touching any adult record", async () => {
    consumePtaHouseholdAdultInvite.mockResolvedValueOnce({ ok: false, error: "This invite has already been used." });

    const result = await acceptPtaHouseholdAdultInvite("stale-token", "a-strong-password");

    expect(result.ok).toBe(false);
    expect(findFirstAdult).not.toHaveBeenCalled();
    expect(updateAdult).not.toHaveBeenCalled();
  });

  it("scopes the adult lookup to the invite's own organizationId — a token can never resolve into a different tenant's adult", async () => {
    consumePtaHouseholdAdultInvite.mockResolvedValueOnce({
      ok: true,
      organizationId: "org-b",
      householdAdultId: "adult-1",
      inviteId: "invite-1",
    });
    findFirstAdult.mockResolvedValueOnce(null); // adult-1 exists, but not in org-b

    const result = await acceptPtaHouseholdAdultInvite("cross-tenant-token", "a-strong-password");

    expect(result.ok).toBe(false);
    expect(findFirstAdult).toHaveBeenCalledWith({ where: { id: "adult-1", organizationId: "org-b" } });
  });

  it("turns a composite-unique-constraint violation (same user, second adult in the same org) into a clean error, not a raw exception", async () => {
    const { Prisma } = await import("@prisma/client");
    findUniqueUser.mockResolvedValueOnce(null);
    createUser.mockResolvedValueOnce({ id: "user-new", email: "jordan@example.com", displayName: "Jordan Lee", mobileTokenVersion: 0 });
    updateAdult.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    );

    const result = await acceptPtaHouseholdAdultInvite("raw-token", "a-strong-password");

    expect(result.ok).toBe(false);
  });
});
