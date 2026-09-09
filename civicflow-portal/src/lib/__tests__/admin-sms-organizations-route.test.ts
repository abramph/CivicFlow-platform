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
const findUniqueOrganization = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSmsSettings: {
      upsert: (...args: unknown[]) => upsertOrgSmsSettings(...args),
      findUnique: (...args: unknown[]) => findUniqueOrgSmsSettings(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => findUniqueOrganization(...args),
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
    findUniqueOrganization.mockReset();
    // Default: existing, NON-exempt organization.
    findUniqueOrganization.mockResolvedValue({ billingExempt: false });
    createAuditEvent.mockClear();
  });

  it("rejects a caller who is not a platform super admin — an org cannot grant itself an entitlement", async () => {
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError());

    const res = await PUT(makeRequest({ smsAddOnActive: true, reason: "x" }), { params: Promise.resolve({ id: "org-1" }) });

    expect(res.status).toBe(403);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent organization and writes nothing", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);

    const res = await PUT(makeRequest({ smsAddOnActive: true, reason: "x" }), { params: Promise.resolve({ id: "org-missing" }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("STRIPE BYPASS GUARD: refuses to newly activate the add-on for a NON-exempt organization — paid orgs must use the Stripe flow", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: false });
    findUniqueOrgSmsSettings.mockResolvedValueOnce(null); // not currently active

    const res = await PUT(
      makeRequest({ smsAddOnActive: true, reason: "trying to skip billing" }),
      { params: Promise.resolve({ id: "org-1" }) }
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/billing-exempt/i);
    expect(json.error).toMatch(/Stripe/);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
    expect(createAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects activation with a MISSING reason", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });

    const res = await PUT(makeRequest({ smsAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reason is required/i);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
  });

  it("rejects activation with a BLANK (whitespace-only) reason", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });

    const res = await PUT(
      makeRequest({ smsAddOnActive: true, reason: "   " }),
      { params: Promise.resolve({ id: "org-1" }) }
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reason is required/i);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
  });

  it("rejects deactivation without a reason", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });

    const res = await PUT(makeRequest({ smsAddOnActive: false }), { params: Promise.resolve({ id: "org-1" }) });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reason is required/i);
    expect(upsertOrgSmsSettings).not.toHaveBeenCalled();
  });

  it("activates a BILLING-EXEMPT org with a reason, audits the trimmed reason + quota, and never touches Stripe", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
    findUniqueOrgSmsSettings.mockResolvedValueOnce(null);
    upsertOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });

    const res = await PUT(
      makeRequest({ smsAddOnActive: true, plan: "STARTER", reason: "  Controlled demo enrollment  " }),
      { params: Promise.resolve({ id: "org-1" }) }
    );

    expect(res.status).toBe(200);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "sms_admin.addon_activated",
        metadata: expect.objectContaining({
          reason: "Controlled demo enrollment",
          billingExempt: true,
          previousAddOnActive: false,
          newAddOnActive: true,
          quota: 1000,
        }),
      })
    );
    // No Stripe dependency: "@/lib/stripe" is deliberately NOT mocked in this
    // suite — any Stripe call from the route would hit the real module and
    // throw on a missing key, failing this test.
  });

  it("re-sending smsAddOnActive:true for an ALREADY-active non-exempt org is an idempotent update, not a fresh activation — and is not blocked", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: false });
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });
    upsertOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });

    const res = await PUT(makeRequest({ smsAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    expect(res.status).toBe(200);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sms_admin.org_settings_updated" })
    );
  });

  it("deactivation with a reason succeeds and writes the distinct audit action", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: true, smsMonthlyLimit: 1000 });
    upsertOrgSmsSettings.mockResolvedValueOnce({ id: "settings-1", smsAddOnActive: false, smsMonthlyLimit: 1000 });

    const res = await PUT(
      makeRequest({ smsAddOnActive: false, reason: "Demo wrap-up" }),
      { params: Promise.resolve({ id: "org-1" }) }
    );

    expect(res.status).toBe(200);
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sms_admin.addon_deactivated",
        metadata: expect.objectContaining({ reason: "Demo wrap-up", previousAddOnActive: true, newAddOnActive: false }),
      })
    );
  });

  it("auto-fills limit/overage/price from the plan tier for STARTER (ordinary edit, no reason needed)", async () => {
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
