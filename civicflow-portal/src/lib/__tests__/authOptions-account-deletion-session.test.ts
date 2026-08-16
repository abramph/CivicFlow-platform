import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueUser = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    mfaChallengeToken: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn().mockResolvedValue({ primaryVertical: "COMMUNITY" }) },
  },
}));

const resolveActiveOrganization = vi.fn();
const getUserOrgMemberships = vi.fn();
vi.mock("@/lib/org-context", () => ({
  resolveActiveOrganization: (...args: unknown[]) => resolveActiveOrganization(...args),
  getUserOrgMemberships: (...args: unknown[]) => getUserOrgMemberships(...args),
}));

const getEffectivePermissions = vi.fn();
vi.mock("@/lib/role-permissions", () => ({
  getEffectivePermissions: (...args: unknown[]) => getEffectivePermissions(...args),
}));

vi.mock("@/lib/platform-access", () => ({
  getPlatformAccessForUser: vi.fn().mockResolvedValue({ hasPlatformAccess: false, platformRoles: [] }),
}));

vi.mock("@/lib/impersonation", () => ({
  resolveImpersonationOverlay: vi.fn().mockResolvedValue(null),
}));

import type { Session } from "next-auth";
import { authOptions } from "@/lib/authOptions";

const sessionCallback = authOptions.callbacks!.session! as unknown as (args: {
  session: Session;
  token: never;
  user: never;
  trigger: undefined;
}) => Promise<Session>;

function emptySession(): Session {
  return { org_id: "", api_key: "", api_base: "" } as Session;
}

describe("authOptions session callback -- account deletion", () => {
  beforeEach(() => {
    findUniqueUser.mockReset();
    resolveActiveOrganization.mockReset();
    getUserOrgMemberships.mockReset();
    getEffectivePermissions.mockReset();
  });

  it("clears session.userId (and every derived field) for a deleted user, even with a still-valid JWT", async () => {
    findUniqueUser.mockResolvedValueOnce({ email: "gone@example.com", deletedAt: new Date("2026-08-01") });

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "gone@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.userId).toBeUndefined();
    expect(result.organizationId).toBeNull();
    expect(result.role).toBeNull();
    expect(result.hasPlatformAccess).toBe(false);
    expect(result.permissions).toEqual([]);
    // resolveActiveOrganization/getUserOrgMemberships run in the same
    // Promise.all as the user lookup and can't be skipped ahead of time --
    // but their results must never reach permission resolution once
    // deletedAt is set, since that's derived from `active` afterward.
    expect(getEffectivePermissions).not.toHaveBeenCalled();
  });

  it("resolves identity normally for a non-deleted user (unaffected control case)", async () => {
    findUniqueUser.mockResolvedValueOnce({ email: "alive@example.com", deletedAt: null });
    resolveActiveOrganization.mockResolvedValueOnce(null);
    getUserOrgMemberships.mockResolvedValueOnce([]);

    const result = await sessionCallback({
      session: emptySession(),
      token: { userId: "user-1", userEmail: "alive@example.com" } as never,
      user: undefined as never,
      trigger: undefined,
    });

    expect(result.userId).toBe("user-1");
  });
});

describe("authOptions saas-credentials authorize -- account deletion", () => {
  it("rejects login for a deleted account before password comparison, same as a nonexistent user", async () => {
    findUniqueUser.mockResolvedValueOnce({
      id: "user-1",
      email: "gone@example.com",
      passwordHash: "irrelevant",
      deletedAt: new Date("2026-08-01"),
    });

    // CredentialsProvider() wraps the passed config under `.options` and
    // hardcodes the top-level `id` to "credentials" for every instance --
    // there are three credentials providers in authOptions, distinguished
    // only by `.options.id`.
    const credentialsProvider = authOptions.providers.find(
      (p) => (p as unknown as { options?: { id?: string } }).options?.id === "saas-credentials"
    ) as unknown as {
      options: { authorize: (credentials: { email: string; password: string }) => Promise<unknown> };
    };
    const result = await credentialsProvider.options.authorize({ email: "gone@example.com", password: "whatever" });

    expect(result).toBeNull();
  });
});
