import { beforeEach, describe, expect, it, vi } from "vitest";
import { SMS_MAX_MONTHLY_QUOTA } from "@/lib/sms-admin-enrollment";

/**
 * Unit tests for the route's own responsibilities: SUPER_ADMIN authorization,
 * tenant scoping (org id from the path), and request validation (404, reason
 * requirement, Stripe-bypass guard, positive/bounded quota), plus that it
 * delegates the write to applySmsAdminOrgSettings and never leaks a Stripe id.
 *
 * The atomic enable/disable transition itself (exactly-one activation, period
 * init, idempotent loser, no duplicate audit) is a real-database property and
 * is proven in admin-sms-organizations-concurrency.integration.test.ts, not
 * here — a mocked Prisma cannot demonstrate row-locked concurrency.
 */

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const applySmsAdminOrgSettings = vi.fn();
vi.mock("@/lib/sms-admin-settings", () => ({
  applySmsAdminOrgSettings: (...args: unknown[]) => applySmsAdminOrgSettings(...args),
}));

const findUniqueOrgSmsSettings = vi.fn();
const findUniqueOrganization = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationSmsSettings: { findUnique: (...args: unknown[]) => findUniqueOrgSmsSettings(...args) },
    organization: { findUnique: (...args: unknown[]) => findUniqueOrganization(...args) },
  },
}));

import { ForbiddenError } from "@/lib/auth-guards";
import { PUT } from "@/app/api/admin/sms/organizations/[id]/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };

function makeRequest(body: unknown) {
  return new Request("https://x/api/admin/sms/organizations/org-1", { method: "PUT", body: JSON.stringify(body) });
}

function call(body: unknown, id = "org-1") {
  return PUT(makeRequest(body), { params: Promise.resolve({ id }) });
}

describe("PUT /api/admin/sms/organizations/[id]", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    applySmsAdminOrgSettings.mockReset();
    applySmsAdminOrgSettings.mockResolvedValue({
      settings: {
        id: "settings-1",
        organizationId: "org-1",
        smsAddOnActive: true,
        smsMonthlyLimit: 1000,
        stripeSmsSubscriptionItemId: "si_should_never_be_exposed",
      },
      action: "sms_admin.addon_activated",
      transitioned: true,
    });
    findUniqueOrgSmsSettings.mockReset();
    findUniqueOrgSmsSettings.mockResolvedValue(null);
    findUniqueOrganization.mockReset();
    findUniqueOrganization.mockResolvedValue({ billingExempt: false });
  });

  it("rejects a non-super-admin (403) and never writes", async () => {
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError());
    const res = await call({ smsAddOnActive: true, reason: "x" });
    expect(res.status).toBe(403);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("returns 404 for a nonexistent organization and never writes", async () => {
    findUniqueOrganization.mockResolvedValueOnce(null);
    const res = await call({ smsAddOnActive: true, reason: "x" }, "org-missing");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("STRIPE-BYPASS GUARD: refuses to newly activate a NON-exempt org (400) and never writes", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: false });
    findUniqueOrgSmsSettings.mockResolvedValueOnce(null);
    const res = await call({ smsAddOnActive: true, reason: "trying to skip billing" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/billing-exempt/i);
    expect(json.error).toMatch(/Stripe/);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("rejects activation with a MISSING reason (400) and never writes", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
    const res = await call({ smsAddOnActive: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reason is required/i);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("rejects activation with a BLANK (whitespace) reason (400) and never writes", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
    const res = await call({ smsAddOnActive: true, reason: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reason is required/i);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("rejects deactivation without a reason (400) and never writes", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ smsAddOnActive: true, smsMonthlyLimit: 1000 });
    const res = await call({ smsAddOnActive: false });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reason is required/i);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("rejects an activation that would produce a zero monthly allowance (400) and never writes", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
    findUniqueOrgSmsSettings.mockResolvedValueOnce(null);
    const res = await call({ smsAddOnActive: true, reason: "forgot the quota" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/positive monthly quota/i);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("rejects a quota above the int4 storage maximum (400) and never writes", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
    const res = await call({ smsAddOnActive: true, reason: "too big", smsMonthlyLimit: SMS_MAX_MONTHLY_QUOTA + 1 });
    expect(res.status).toBe(400);
    expect(applySmsAdminOrgSettings).not.toHaveBeenCalled();
  });

  it("delegates a valid billing-exempt activation with the trimmed reason and 200s", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
    findUniqueOrgSmsSettings.mockResolvedValueOnce(null);
    const res = await call({ smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "  Controlled demo enrollment  " });
    expect(res.status).toBe(200);
    expect(applySmsAdminOrgSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        reason: "Controlled demo enrollment",
        billingExempt: true,
        input: expect.objectContaining({ smsAddOnActive: true, smsMonthlyLimit: 1000 }),
        actor: { userId: "user-1", userEmail: "admin@example.com" },
      })
    );
  });

  it("never returns a Stripe identifier in the response body", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: true });
    const res = await call({ smsAddOnActive: true, smsMonthlyLimit: 1000, reason: "enroll" });
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).not.toHaveProperty("stripeSmsSubscriptionItemId");
    expect(JSON.stringify(json)).not.toContain("si_should_never_be_exposed");
  });

  it("delegates a deactivation with a reason and 200s", async () => {
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ smsAddOnActive: true, smsMonthlyLimit: 1000 });
    const res = await call({ smsAddOnActive: false, reason: "Demo wrap-up" });
    expect(res.status).toBe(200);
    expect(applySmsAdminOrgSettings).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ smsAddOnActive: false }), reason: "Demo wrap-up" })
    );
  });

  it("an already-active non-exempt re-send is NOT a fresh activation — no billing-exempt gate, delegates, 200", async () => {
    findUniqueOrganization.mockResolvedValueOnce({ billingExempt: false });
    findUniqueOrgSmsSettings.mockResolvedValueOnce({ smsAddOnActive: true, smsMonthlyLimit: 1000 });
    const res = await call({ smsAddOnActive: true });
    expect(res.status).toBe(200);
    expect(applySmsAdminOrgSettings).toHaveBeenCalledTimes(1);
  });

  it("an ordinary settings edit (plan) needs no reason and delegates", async () => {
    const res = await call({ plan: "STARTER" });
    expect(res.status).toBe(200);
    expect(applySmsAdminOrgSettings).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ plan: "STARTER" }) })
    );
  });
});
