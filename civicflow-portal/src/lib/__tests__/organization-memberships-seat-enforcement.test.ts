import { beforeEach, describe, expect, it, vi } from "vitest";

let actorRole = "ORG_OWNER";
let organizationMembershipCount = 0;

const findFirstMembership = vi.fn();
const updateMembership = vi.fn();
const createMembership = vi.fn();
const findFirstExistingMembership = vi.fn().mockResolvedValue(null);
const findUniqueOrgRolePermissionSet = vi.fn().mockResolvedValue(null);
const findUniqueOrThrowOrganization = vi.fn();
const queryRaw = vi.fn().mockResolvedValue(undefined);
const findUniqueUser = vi.fn().mockResolvedValue(null);
const createUser = vi.fn().mockResolvedValue({ id: "u2", email: "new@example.com", displayName: "New" });

function membershipDelegate() {
  return {
    findFirst: (...args: unknown[]) => {
      const where = (args[0] as { where?: Record<string, unknown> } | undefined)?.where;
      if (where && "userId" in where) return findFirstExistingMembership(...args);
      return findFirstMembership(...args);
    },
    update: (...args: unknown[]) => updateMembership(...args),
    create: (...args: unknown[]) => createMembership(...args),
    // Backs getUsedAdminSeats() inside the transactional seat lock.
    count: () => Promise.resolve(organizationMembershipCount),
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
    organization: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowOrganization(...args) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        organizationMembership: membershipDelegate(),
        organization: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowOrganization(...args) },
        $queryRaw: (...args: unknown[]) => queryRaw(...args),
      }),
  },
}));

vi.mock("@/lib/auth-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guards")>();
  return {
    ...actual,
    requirePermission: vi.fn(async () => ({
      session: { userId: "actor-1", userEmail: "owner@example.com" },
      organizationId: "org-a",
      role: actorRole,
    })),
  };
});

vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("bcryptjs", () => ({ hash: vi.fn().mockResolvedValue("hashed") }));

import { PATCH } from "@/app/api/organization-memberships/[id]/route";
import { POST } from "@/app/api/organization-memberships/route";

function postRequest(role: string) {
  return new Request("https://portal.test/api/organization-memberships", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "new@example.com",
      displayName: "New Person",
      role,
      temporaryPassword: "a-temp-password-1",
    }),
  });
}

function patchRequest(role: string) {
  return new Request("https://portal.test/api/organization-memberships/m1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

// A PTA org (10 included seats) with no override/purchased seats — matches
// the CLOUD-SEAT-B default allowance used throughout this suite.
function ptaOrgFixture() {
  return { primaryVertical: "PTA", adminSeatOverride: 0, purchasedAdminSeats: 0 };
}

beforeEach(() => {
  actorRole = "ORG_OWNER";
  organizationMembershipCount = 0;
  findFirstMembership.mockReset();
  updateMembership.mockReset();
  updateMembership.mockImplementation(async (args: { data: { role: string } }) => ({
    id: "m1",
    role: args.data.role,
    user: { id: "target-1", email: "target@example.com", displayName: null, createdAt: new Date() },
  }));
  createMembership.mockReset();
  createMembership.mockImplementation(async (args: { data: { role: string } }) => ({
    id: "new-membership",
    role: args.data.role,
    user: { id: "u2", email: "new@example.com", displayName: "New", createdAt: new Date() },
  }));
  findFirstExistingMembership.mockResolvedValue(null);
  findUniqueOrgRolePermissionSet.mockReset();
  findUniqueOrgRolePermissionSet.mockResolvedValue(null);
  findUniqueOrThrowOrganization.mockReset();
  findUniqueOrThrowOrganization.mockResolvedValue(ptaOrgFixture());
  queryRaw.mockClear();
});

describe("POST /api/organization-memberships — admin-seat enforcement", () => {
  it("rejects creating a seat-consuming membership (STAFF) once the org is at its effective seat limit", async () => {
    organizationMembershipCount = 10; // == PTA's included limit

    const response = await POST(postRequest("STAFF"));

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("ADMIN_SEAT_LIMIT_REACHED");
    expect(body.error).toContain("administrative seats");
    expect(body.error).not.toMatch(/member/i); // must never imply an ordinary-member limit
    expect(createMembership).not.toHaveBeenCalled();
  });

  it("locks the organization row before evaluating availability (SELECT ... FOR UPDATE)", async () => {
    organizationMembershipCount = 3;
    await POST(postRequest("STAFF"));
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("allows creating a seat-consuming membership when a seat is available", async () => {
    organizationMembershipCount = 9; // one seat free out of 10

    const response = await POST(postRequest("STAFF"));

    expect(response.status).toBe(201);
    expect(createMembership).toHaveBeenCalled();
  });

  it("never blocks creating a non-seat-consuming READ_ONLY membership, even at a full seat pool", async () => {
    organizationMembershipCount = 10;

    const response = await POST(postRequest("READ_ONLY"));

    expect(response.status).toBe(201);
    expect(createMembership).toHaveBeenCalled();
    // No seat check should even run for a role that never consumes one.
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/organization-memberships/[id] — admin-seat enforcement", () => {
  it("rejects a promotion from a non-seat-consuming role into a seat-consuming one at the seat limit", async () => {
    organizationMembershipCount = 10;
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "READ_ONLY",
      userId: "target-1",
      user: { id: "target-1", email: "target@example.com" },
    });

    const response = await PATCH(patchRequest("STAFF"), { params: Promise.resolve({ id: "m1" }) });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("ADMIN_SEAT_LIMIT_REACHED");
    expect(updateMembership).not.toHaveBeenCalled();
  });

  it("allows a lateral move between two seat-consuming roles even at the seat limit (seat-neutral)", async () => {
    organizationMembershipCount = 10;
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "STAFF",
      userId: "target-1",
      user: { id: "target-1", email: "target@example.com" },
    });

    const response = await PATCH(patchRequest("FINANCE"), { params: Promise.resolve({ id: "m1" }) });

    expect(response.status).toBe(200);
    expect(updateMembership).toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled(); // never even attempts the lock — seat-neutral
  });

  it("always allows a demotion into a non-seat-consuming role, even at the seat limit (frees a seat)", async () => {
    organizationMembershipCount = 10;
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "STAFF",
      userId: "target-1",
      user: { id: "target-1", email: "target@example.com" },
    });

    const response = await PATCH(patchRequest("READ_ONLY"), { params: Promise.resolve({ id: "m1" }) });

    expect(response.status).toBe(200);
    expect(updateMembership).toHaveBeenCalled();
  });

  it("allows a promotion into a seat-consuming role when a seat is available", async () => {
    organizationMembershipCount = 9;
    findFirstMembership.mockResolvedValueOnce({
      id: "m1",
      role: "READ_ONLY",
      userId: "target-1",
      user: { id: "target-1", email: "target@example.com" },
    });

    const response = await PATCH(patchRequest("STAFF"), { params: Promise.resolve({ id: "m1" }) });

    expect(response.status).toBe(200);
    expect(updateMembership).toHaveBeenCalled();
  });
});
