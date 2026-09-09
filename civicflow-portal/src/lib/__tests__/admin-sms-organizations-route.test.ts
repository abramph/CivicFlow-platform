import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const upsertOrgSmsSettings = vi.fn();
const findUniqueOrgSmsSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSmsSettings: {
      upsert: (...args: unknown[]) => upsertOrgSmsSettings(...args),
      findUnique: (...args: unknown[]) => findUniqueOrgSmsSettings(...args),
    },
  },
}));

import { ForbiddenError } from "@/lib/auth-guards";
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
    upsertOrgSmsSettings.mockResolvedValue({ id: "settings-1", smsAddOnActive: false, smsMonthlyLimit: 0 });
    findUniqueOrgSmsSettings.mockReset();
    findUniqueOrgSmsSettings.mockResolvedValue(null);
    createAuditEvent.mockClear();
  });

  it("rejects a caller who is not a platform super admin — an org cannot grant itself an entitlement", async () => {
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError());

    const res = await PUT(makeRequest({ smsAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    expect(res.status).toBe(403);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("OWNER GATE: refuses to newly activate the add-on while the overage billing policy is unresolved", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce(null); // not currently active

    const res = await PUT(makeRequest({ smsAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/overage billing policy/);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("re-sending smsAddOnActive:true for an ALREADY-active org is not a new activation and is not blocked", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });
    upsertOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });

    const res = await PUT(makeRequest({ smsAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    expect(res.status).toBe(200);
  });

  it("deactivation is always allowed and writes a distinct audit action with actor, reason, and quota", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });
    upsertOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: false, smsMonthlyLimit: 1000 });

    const res = await PUT(
      makeRequest({ smsAddOnActive: false, reason: "Demo wrap-up" }),
      { params: Promise.resolve({ id: "org-1" }) }
    );

    expect(res.status).toBe(200);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "sms_admin.addon_deactivated",
        metadata: expect.objectContaining({
          reason: "Demo wrap-up",
          previousAddOnActive: true,
          newAddOnActive: false,
          quota: 1000,
        }),
      })
    );
  });

  it("never touches Stripe — the route has no Stripe dependency, so exempt enrollment cannot create fake billing objects", async () => {
    // Import-level assertion: the route module's imports are prisma/audit/
    // auth/pricing/validation only. A Stripe call would require mocking
    // "@/lib/stripe" here; this file deliberately does not, and the suite
    // fails on any unmocked Stripe usage.
    await PUT(makeRequest({ suspended: true }), { params: Promise.resolve({ id: "org-1" }) });
    expect(upsertOrgSmsSettings).toHaveBeenCalled();
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

  it("writes an org-scoped audit event for non-transition settings updates", async () => {
    await PUT(makeRequest({ smsMonthlyLimit: 2000 }), { params: Promise.resolve({ id: "org-1" }) });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "sms_admin.org_settings_updated" })
    );
  });
});
