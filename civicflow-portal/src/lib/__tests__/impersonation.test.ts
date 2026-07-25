import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstMembership = vi.fn();
const findUniqueUser = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: { findFirst: (...a: unknown[]) => findFirstMembership(...a) },
    user: { findUnique: (...a: unknown[]) => findUniqueUser(...a) },
  },
}));

const getPlatformAccessForUser = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  getPlatformAccessForUser: (...a: unknown[]) => getPlatformAccessForUser(...a),
}));

const getCookie = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: getCookie }),
}));

import { resolveImpersonationOverlay, type ImpersonationCookiePayload } from "@/lib/impersonation";

function cookiePayload(overrides: Partial<ImpersonationCookiePayload> = {}): ImpersonationCookiePayload {
  return {
    actorUserId: "admin-1",
    actorEmail: "admin@unestra.example",
    targetUserId: "target-1",
    organizationId: "org-a",
    sessionId: "session-1",
    startedAt: new Date().toISOString(),
    reason: null,
    priorActiveOrgId: null,
    ...overrides,
  };
}

function setCookie(payload: ImpersonationCookiePayload | null) {
  getCookie.mockReturnValue(payload ? { value: JSON.stringify(payload) } : undefined);
}

const activeMembership = {
  organization: { name: "Pine Grove School PTA", status: "active" },
};

beforeEach(() => {
  findFirstMembership.mockReset();
  findUniqueUser.mockReset();
  getPlatformAccessForUser.mockReset();
  getCookie.mockReset();
});

describe("resolveImpersonationOverlay — fails closed on every check", () => {
  it("returns null when there is no impersonation cookie at all", async () => {
    setCookie(null);
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
    expect(getPlatformAccessForUser).not.toHaveBeenCalled();
  });

  it("returns null when the cookie is malformed JSON", async () => {
    getCookie.mockReturnValue({ value: "{not json" });
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
  });

  it("returns null when the cookie's actorUserId doesn't match the REAL signed-in user — prevents a stolen/replayed cookie from a different account being honored", async () => {
    setCookie(cookiePayload({ actorUserId: "someone-else" }));
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
    expect(getPlatformAccessForUser).not.toHaveBeenCalled();
  });

  it("returns null once the cookie is older than the 4-hour cap, even if never explicitly stopped", async () => {
    setCookie(cookiePayload({ startedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() }));
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
    expect(getPlatformAccessForUser).not.toHaveBeenCalled();
  });

  it("returns null when the real user no longer holds platform access — the critical re-check that runs on every request, not just at start", async () => {
    setCookie(cookiePayload());
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
    expect(findFirstMembership).not.toHaveBeenCalled();
  });

  it("returns null — instead of granting access to a non-member org — when a non-platform-admin manually crafts this cookie for their own account", async () => {
    // Simulates: a regular authenticated user (not a real platform admin)
    // somehow sets this cookie themselves, naming their own account as actor.
    setCookie(cookiePayload({ actorUserId: "regular-user" }));
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: false, platformRoles: [] });
    const result = await resolveImpersonationOverlay("regular-user");
    expect(result).toBeNull();
  });

  it("returns null when the target no longer belongs to the pinned organization (removed mid-session)", async () => {
    setCookie(cookiePayload());
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    findFirstMembership.mockResolvedValueOnce(null);
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
  });

  it("returns null when the organization has been suspended mid-session", async () => {
    setCookie(cookiePayload());
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    findFirstMembership.mockResolvedValueOnce({ organization: { name: "Pine Grove School PTA", status: "suspended" } });
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
  });

  it("returns null when the target user was deleted mid-session", async () => {
    setCookie(cookiePayload());
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    findFirstMembership.mockResolvedValueOnce(activeMembership);
    findUniqueUser.mockResolvedValueOnce({ email: "admin@unestra.example", displayName: "Admin" }); // actor
    findUniqueUser.mockResolvedValueOnce(null); // target — gone
    const result = await resolveImpersonationOverlay("admin-1");
    expect(result).toBeNull();
  });

  it("returns a full overlay when every check passes", async () => {
    setCookie(cookiePayload({ reason: "demo for prospect" }));
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    findFirstMembership.mockResolvedValueOnce(activeMembership);
    findUniqueUser.mockResolvedValueOnce({ email: "admin@unestra.example", displayName: "Admin Person" });
    findUniqueUser.mockResolvedValueOnce({ email: "sarah@pinegrovepta.example", displayName: "Sarah Mitchell" });

    const result = await resolveImpersonationOverlay("admin-1");

    expect(result).toMatchObject({
      actorUserId: "admin-1",
      actorEmail: "admin@unestra.example",
      targetUserId: "target-1",
      targetDisplayName: "Sarah Mitchell",
      organizationId: "org-a",
      organizationName: "Pine Grove School PTA",
      reason: "demo for prospect",
    });
  });

  it("scopes the membership re-check to organizationId AND status active, never trusting the cookie's org claim alone", async () => {
    setCookie(cookiePayload({ organizationId: "org-b" }));
    getPlatformAccessForUser.mockResolvedValueOnce({ hasPlatformAccess: true, platformRoles: ["SUPER_ADMIN"] });
    findFirstMembership.mockResolvedValueOnce(activeMembership);
    findUniqueUser.mockResolvedValueOnce({ email: "admin@unestra.example", displayName: "Admin" });
    findUniqueUser.mockResolvedValueOnce({ email: "target@example.com", displayName: "Target" });

    await resolveImpersonationOverlay("admin-1");

    expect(findFirstMembership).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "target-1", organizationId: "org-b", status: "active" } })
    );
  });
});
