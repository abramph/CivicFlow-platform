import { beforeEach, describe, expect, it, vi } from "vitest";

const requirePtaAccess = vi.fn().mockResolvedValue({
  session: { userId: "officer-1", userEmail: "officer@example.com" },
  organizationId: "org-a",
});
vi.mock("@/lib/labs/pta/guard", () => ({
  requirePtaAccess: (...args: unknown[]) => requirePtaAccess(...args),
}));

const findFirstAdult = vi.fn();
const findUniqueOrganization = vi.fn().mockResolvedValue({ name: "Pine Grove School PTA" });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ptaHouseholdAdult: { findFirst: (...args: unknown[]) => findFirstAdult(...args) },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
  },
}));

vi.mock("@/lib/rate-limit", () => ({ requireRateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const sendPtaHouseholdAdultInviteEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/pta/household-adult-invites", () => ({
  sendPtaHouseholdAdultInviteEmail: (...args: unknown[]) => sendPtaHouseholdAdultInviteEmail(...args),
}));

import { POST } from "@/app/api/labs/pta/households/[householdId]/adults/[adultId]/invite/route";

function request() {
  return new Request("https://portal.test/api/labs/pta/households/h1/adults/a1/invite", { method: "POST" });
}
const params = Promise.resolve({ householdId: "h1", adultId: "a1" });

describe("POST /api/labs/pta/households/[householdId]/adults/[adultId]/invite", () => {
  beforeEach(() => {
    findFirstAdult.mockReset();
    sendPtaHouseholdAdultInviteEmail.mockClear().mockResolvedValue(undefined);
  });

  it("sends an invite for an adult with an email and no existing login", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "a1", email: "parent@example.com", name: "Parent One", userId: null });

    const response = await POST(request(), { params });
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(sendPtaHouseholdAdultInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ householdAdult: { id: "a1", email: "parent@example.com", name: "Parent One" }, organizationId: "org-a" })
    );
  });

  it("rejects when the adult already has app login credentials", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "a1", email: "parent@example.com", name: "Parent One", userId: "user-existing" });

    const response = await POST(request(), { params });
    const body = await response.json();

    expect(response.ok).toBe(false);
    expect(body.ok).toBe(false);
    expect(sendPtaHouseholdAdultInviteEmail).not.toHaveBeenCalled();
  });

  it("rejects when the adult has no email on file", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "a1", email: null, name: "Parent One", userId: null });

    const response = await POST(request(), { params });
    const body = await response.json();

    expect(response.ok).toBe(false);
    expect(body.ok).toBe(false);
    expect(sendPtaHouseholdAdultInviteEmail).not.toHaveBeenCalled();
  });

  it("404s when the adult does not exist in this household/organization — no cross-tenant/wrong-household leakage", async () => {
    findFirstAdult.mockResolvedValueOnce(null);

    const response = await POST(request(), { params });
    expect(response.status).toBe(404);
    expect(sendPtaHouseholdAdultInviteEmail).not.toHaveBeenCalled();
    expect(findFirstAdult).toHaveBeenCalledWith({ where: { id: "a1", householdId: "h1", organizationId: "org-a" } });
  });
});
