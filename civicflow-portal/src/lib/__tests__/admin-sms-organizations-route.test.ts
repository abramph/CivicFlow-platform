import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const upsertOrgSmsSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { organizationSmsSettings: { upsert: (...args: unknown[]) => upsertOrgSmsSettings(...args) } },
}));

import { PUT } from "@/app/api/admin/sms/organizations/[id]/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };

function makeRequest(body: unknown) {
  return new Request("https://x/api/admin/sms/organizations/org-1", { method: "PUT", body: JSON.stringify(body) });
}

describe("PUT /api/admin/sms/organizations/[id]", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    upsertOrgSmsSettings.mockReset();
    upsertOrgSmsSettings.mockResolvedValue({ id: "settings-1" });
    createAuditEvent.mockClear();
  });

  it("auto-fills limit/overage/price from the plan tier for STARTER", async () => {
    await PUT(makeRequest({ plan: "STARTER" }), { params: Promise.resolve({ id: "org-1" }) });

    expect(upsertOrgSmsSettings).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      create: { organizationId: "org-1", plan: "STARTER", smsMonthlyLimit: 1000, smsOverageRateCents: 2, planPriceCents: 1000 },
      update: { plan: "STARTER", smsMonthlyLimit: 1000, smsOverageRateCents: 2, planPriceCents: 1000 },
    });
  });

  it("does not auto-fill for ENTERPRISE — requires explicit numbers", async () => {
    await PUT(
      makeRequest({ plan: "ENTERPRISE", smsMonthlyLimit: 50000, smsOverageRateCents: 1, planPriceCents: 50000 }),
      { params: Promise.resolve({ id: "org-1" }) }
    );

    const call = upsertOrgSmsSettings.mock.calls[0][0];
    expect(call.update).toEqual({
      plan: "ENTERPRISE",
      smsMonthlyLimit: 50000,
      smsOverageRateCents: 1,
      planPriceCents: 50000,
    });
  });

  it("lets an explicit override win over the plan default", async () => {
    await PUT(makeRequest({ plan: "STARTER", smsMonthlyLimit: 5000 }), { params: Promise.resolve({ id: "org-1" }) });

    const call = upsertOrgSmsSettings.mock.calls[0][0];
    expect(call.update.smsMonthlyLimit).toBe(5000);
  });

  it("sets/clears suspendedAt from the suspended flag", async () => {
    await PUT(makeRequest({ suspended: true }), { params: Promise.resolve({ id: "org-1" }) });
    expect(upsertOrgSmsSettings.mock.calls[0][0].update.suspendedAt).toBeInstanceOf(Date);

    upsertOrgSmsSettings.mockClear();
    await PUT(makeRequest({ suspended: false }), { params: Promise.resolve({ id: "org-1" }) });
    expect(upsertOrgSmsSettings.mock.calls[0][0].update.suspendedAt).toBeNull();
  });

  it("writes an org-scoped audit event", async () => {
    await PUT(makeRequest({ smsAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "sms_admin.org_settings_updated" })
    );
  });
});
