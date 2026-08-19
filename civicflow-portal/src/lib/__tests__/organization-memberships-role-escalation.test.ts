import { beforeEach, describe, expect, it, vi } from "vitest";

let actorRole = "ORG_ADMIN";

const findFirstMembership = vi.fn();
const updateMembership = vi.fn();
const deleteMembership = vi.fn();
const findUniqueUser = vi.fn();
const createUser = vi.fn();
const createMembership = vi.fn();
const findFirstExistingMembership = vi.fn().mockResolvedValue(null);
const findUniqueOrgRolePermissionSet = vi.fn().mockResolvedValue(null);

function membershipDelegate() {
  return {
    findFirst: (...args: unknown[]) => {
      // POST create-flow checks for an existing membership for the invited user;
      // PATCH/DELETE flows look up the target membership by id — route by shape.
      const where = (args[0] as { where?: Record<string, unknown> } | undefined)?.where;
      if (where && "userId" in where) return findFirstExistingMembership(...args);
      return findFirstMembership(...args);
    },
    update: (...args: unknown[]) => updateMembership(...args),
    delete: (...args: unknown[]) => deleteMembership(...args),
    create: (...args: unknown[]) => createMembership(...args),
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMembership: membershipDelegate(),
    user: {
      findUnique: (...args: unknown[]) => findUniqueUser(...args),
      create: (...args: unknown[]) => createUser(...args),
    },
    orgRolePermissionSet: { findUnique: (...args: unknown[]) => findUniqueOrgRolePermissionSet(...args) },
    // Only PATCH/POST use $transaction, and only when the role change/create
    // actually crosses into seat-consuming territory does anything inside it
    // touch $queryRaw/organization — this repo's route code always wraps the
    // write in $transaction regardless, so every route under test needs it.
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        organizationMembership: membershipDelegate(),
        $queryRaw: vi.fn(),
      }),
  },
}));

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn(async () => ({
      session: { userId: "actor-1", userEmail: "admin@example.com" },
      organizationId: "org-a",
      role: actorRole,
    })),
  };
});

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("bcryptjs", () => ({ hash: vi.fn().mockResolvedValue("hashed") }));

import { PATCH, DELETE } from "@/app/api/organization-memberships/[id]/route";
import { POST } from "@/app/api/organization-memberships/route";

function jsonRequest(body: unknown, method = "PATCH") {
  return new Request("https://portal.test/api/organization-memberships/m1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("organization-memberships: role-escalation hardening", () => {
  beforeEach(() => {
    actorRole = "ORG_ADMIN";
    findFirstMembership.mockReset();
    updateMembership.mockReset();
    deleteMembership.mockReset();
    findFirstExistingMembership.mockResolvedValue(null);
    createMembership.mockReset();
    createMembership.mockResolvedValue({
      id: "new-membership",
      role: "STAFF",
      user: { id: "u2", email: "new@example.com", displayName: "New", createdAt: new Date() },
    });
    findUniqueUser.mockReset();
    findUniqueUser.mockResolvedValue(null);
    createUser.mockReset();
    createUser.mockResolvedValue({ id: "u2", email: "new@example.com", displayName: "New" });
    findUniqueOrgRolePermissionSet.mockReset();
    findUniqueOrgRolePermissionSet.mockResolvedValue(null);
  });

  it("PATCH: an ORG_ADMIN cannot promote a member to ORG_OWNER", async () => {
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "STAFF",
      userId: "target-1",
      user: { id: "target-1", email: "staff@example.com" },
    });

    const response = await PATCH(jsonRequest({ role: "ORG_OWNER" }), { params: Promise.resolve({ id: "m1" }) });
    expect(response.status).toBe(400);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("PATCH: an ORG_ADMIN cannot change the role of an existing ORG_OWNER", async () => {
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "ORG_OWNER",
      userId: "owner-1",
      user: { id: "owner-1", email: "owner@example.com" },
    });

    const response = await PATCH(jsonRequest({ role: "STAFF" }), { params: Promise.resolve({ id: "m1" }) });
    expect(response.status).toBe(400);
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("PATCH: an ORG_OWNER may promote someone else to ORG_OWNER (co-owner)", async () => {
    actorRole = "ORG_OWNER";
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "ORG_ADMIN",
      userId: "target-1",
      user: { id: "target-1", email: "admin@example.com" },
    });
    updateMembership.mockResolvedValueOnce({
      id: "m1",
      role: "ORG_OWNER",
      user: { id: "target-1", email: "admin@example.com", displayName: null, createdAt: new Date() },
    });

    const response = await PATCH(jsonRequest({ role: "ORG_OWNER" }), { params: Promise.resolve({ id: "m1" }) });
    expect(response.status).toBe(200);
    expect(updateMembership).toHaveBeenCalled();
  });

  it("DELETE: an ORG_ADMIN cannot remove an ORG_OWNER's access", async () => {
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "ORG_OWNER",
      userId: "owner-1",
      user: { id: "owner-1", email: "owner@example.com" },
    });

    const response = await DELETE(jsonRequest(undefined, "DELETE"), { params: Promise.resolve({ id: "m1" }) });
    expect(response.status).toBe(400);
    expect(deleteMembership).not.toHaveBeenCalled();
  });

  it("POST: an ORG_ADMIN cannot invite a brand-new user directly as ORG_OWNER", async () => {
    const response = await POST(
      new Request("https://portal.test/api/organization-memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new@example.com",
          displayName: "New Person",
          role: "ORG_OWNER",
          temporaryPassword: "a-temp-password-1",
        }),
      })
    );
    expect(response.status).toBe(400);
    expect(createMembership).not.toHaveBeenCalled();
  });
});
