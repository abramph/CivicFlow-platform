import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMobilePtaHouseholdsPermission = vi.fn().mockResolvedValue({
  userId: "officer-1",
  email: "officer@example.com",
  role: "ORG_ADMIN",
});
vi.mock("@/lib/mobile-admin-pta", () => ({
  requireMobilePtaHouseholdsPermission: (...args: unknown[]) => requireMobilePtaHouseholdsPermission(...args),
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
const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const sendPtaHouseholdAdultInviteEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/labs/pta/household-adult-invites", () => ({
  sendPtaHouseholdAdultInviteEmail: (...args: unknown[]) => sendPtaHouseholdAdultInviteEmail(...args),
}));

import { POST } from "@/app/api/mobile/admin/pta/households/[householdId]/adults/[adultId]/invite/route";
import { PERMISSIONS } from "@/lib/rbac";

function request(body: unknown = { organizationId: "org-a" }) {
  return new Request("https://portal.test/api/mobile/admin/pta/households/h1/adults/a1/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ householdId: "h1", adultId: "a1" });

describe("POST /api/mobile/admin/pta/households/[householdId]/adults/[adultId]/invite", () => {
  beforeEach(() => {
    findFirstAdult.mockReset();
    requireMobilePtaHouseholdsPermission.mockClear();
    sendPtaHouseholdAdultInviteEmail.mockClear().mockResolvedValue(undefined);
    createAuditEvent.mockClear();
  });

  it("sends an invite through the same service as the web route, with the two-gate guard and exact permission", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "a1", email: "parent@example.com", name: "Parent One", userId: null });

    const response = await POST(request(), { params });
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(requireMobilePtaHouseholdsPermission).toHaveBeenCalledWith(expect.any(Request), "org-a", PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);
    expect(sendPtaHouseholdAdultInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ householdAdult: { id: "a1", email: "parent@example.com", name: "Parent One" }, organizationId: "org-a" })
    );
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pta.household_adult.invited", entityId: "a1", organizationId: "org-a" })
    );
  });

  it("rejects when the adult already has app login credentials", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "a1", email: "parent@example.com", name: "Parent One", userId: "user-existing" });

    const response = await POST(request(), { params });
    expect(response.ok).toBe(false);
    expect(sendPtaHouseholdAdultInviteEmail).not.toHaveBeenCalled();
  });

  it("rejects when the adult has no email on file", async () => {
    findFirstAdult.mockResolvedValueOnce({ id: "a1", email: null, name: "Parent One", userId: null });

    const response = await POST(request(), { params });
    expect(response.ok).toBe(false);
    expect(sendPtaHouseholdAdultInviteEmail).not.toHaveBeenCalled();
  });

  it("404s when the adult is not in this household/organization — the lookup is tenant- and household-scoped", async () => {
    findFirstAdult.mockResolvedValueOnce(null);

    const response = await POST(request(), { params });
    expect(response.status).toBe(404);
    expect(findFirstAdult).toHaveBeenCalledWith({ where: { id: "a1", householdId: "h1", organizationId: "org-a" } });
    expect(sendPtaHouseholdAdultInviteEmail).not.toHaveBeenCalled();
  });

  it("propagates the guard's denial and never touches the adult or sends mail", async () => {
    const { MobileForbiddenError } = await import("@/lib/mobile-auth");
    requireMobilePtaHouseholdsPermission.mockRejectedValueOnce(new MobileForbiddenError("nope"));

    const response = await POST(request(), { params });
    expect(response.status).toBe(403);
    expect(findFirstAdult).not.toHaveBeenCalled();
    expect(sendPtaHouseholdAdultInviteEmail).not.toHaveBeenCalled();
  });
});
