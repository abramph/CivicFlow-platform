import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeMemberInvite = vi.fn();
const markMemberInviteAccepted = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/member-invites", () => ({
  consumeMemberInvite: (...args: unknown[]) => consumeMemberInvite(...args),
  markMemberInviteAccepted: (...args: unknown[]) => markMemberInviteAccepted(...args),
}));

const findFirstOrgMember = vi.fn();
const findUniqueUser = vi.fn();
const createUser = vi.fn();
const transaction = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    orgMember: {
      findFirst: (...args: unknown[]) => findFirstOrgMember(...args),
      update: vi.fn(),
    },
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
      create: (...args: unknown[]) => createUser(...args),
    },
    organizationMembership: { upsert: vi.fn() },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

import bcrypt from "bcryptjs";
import { acceptMemberInvite } from "@/lib/accept-invite";

describe("acceptMemberInvite", () => {
  beforeEach(() => {
    consumeMemberInvite.mockReset();
    findFirstOrgMember.mockReset();
    findUniqueUser.mockReset();
    createUser.mockReset();
    transaction.mockClear();

    consumeMemberInvite.mockResolvedValue({
      ok: true,
      organizationId: "org-a",
      memberId: "member-1",
      inviteId: "invite-1",
    });
    findFirstOrgMember.mockResolvedValue({
      id: "member-1",
      firstName: "Pat",
      lastName: "Doe",
      email: "pat@example.com",
      userId: null,
    });
  });

  it("creates a new user when no account exists for the email", async () => {
    findUniqueUser.mockResolvedValueOnce(null);
    createUser.mockResolvedValueOnce({ id: "user-new", email: "pat@example.com", displayName: "Pat Doe" });

    const result = await acceptMemberInvite("raw-token", "a-strong-password");

    expect(result.ok).toBe(true);
    expect(createUser).toHaveBeenCalled();
    expect(transaction).toHaveBeenCalled();
  });

  it("links to an existing account when the submitted password matches it", async () => {
    const passwordHash = await bcrypt.hash("real-password", 12);
    findUniqueUser.mockResolvedValueOnce({ id: "user-existing", email: "pat@example.com", displayName: "Pat", passwordHash });

    const result = await acceptMemberInvite("raw-token", "real-password");

    expect(result.ok).toBe(true);
    expect(createUser).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalled();
  });

  it("rejects linking to an existing account when the submitted password does not match", async () => {
    const passwordHash = await bcrypt.hash("real-password", 12);
    findUniqueUser.mockResolvedValueOnce({ id: "user-existing", email: "pat@example.com", displayName: "Pat", passwordHash });

    const result = await acceptMemberInvite("raw-token", "some-guessed-password");

    expect(result.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });
});
