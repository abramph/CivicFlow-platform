import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findUniqueOrgWhatsAppSettings = vi.fn();
const upsertOrgWhatsAppSettings = vi.fn();
const updateOrgWhatsAppSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationWhatsAppSettings: {
      findUnique: (...args: unknown[]) => findUniqueOrgWhatsAppSettings(...args),
      upsert: (...args: unknown[]) => upsertOrgWhatsAppSettings(...args),
      update: (...args: unknown[]) => updateOrgWhatsAppSettings(...args),
    },
  },
}));

import { PUT } from "@/app/api/admin/whatsapp/organizations/[id]/route";
import { POST as resetUsage } from "@/app/api/admin/whatsapp/organizations/[id]/reset-usage/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };

function makeRequest(body: unknown) {
  return new Request("https://x/api/admin/whatsapp/organizations/org-1", { method: "PUT", body: JSON.stringify(body) });
}

describe("PUT /api/admin/whatsapp/organizations/[id]", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    findUniqueOrgWhatsAppSettings.mockReset();
    findUniqueOrgWhatsAppSettings.mockResolvedValue(null);
    upsertOrgWhatsAppSettings.mockReset();
    upsertOrgWhatsAppSettings.mockResolvedValue({ id: "settings-1" });
    createAuditEvent.mockClear();
  });

  it("default-fills limit/overage from WHATSAPP_ADDON on first activation", async () => {
    await PUT(makeRequest({ whatsappAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    const call = upsertOrgWhatsAppSettings.mock.calls[0][0];
    expect(call.update).toEqual({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 500,
      whatsappOverageRateCents: 5,
    });
  });

  it("does not re-default-fill when the org is already active", async () => {
    findUniqueOrgWhatsAppSettings.mockResolvedValue({ whatsappAddOnActive: true, whatsappMonthlyLimit: 2000 });

    await PUT(makeRequest({ whatsappAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    const call = upsertOrgWhatsAppSettings.mock.calls[0][0];
    expect(call.update).toEqual({ whatsappAddOnActive: true });
  });

  it("does not default-fill when a monthly limit is already set, even on first activation", async () => {
    findUniqueOrgWhatsAppSettings.mockResolvedValue({ whatsappAddOnActive: false, whatsappMonthlyLimit: 9000 });

    await PUT(makeRequest({ whatsappAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });

    const call = upsertOrgWhatsAppSettings.mock.calls[0][0];
    expect(call.update).toEqual({ whatsappAddOnActive: true });
  });

  it("lets an explicit override win over the activation default-fill", async () => {
    await PUT(
      makeRequest({ whatsappAddOnActive: true, whatsappMonthlyLimit: 10000, whatsappOverageRateCents: 2 }),
      { params: Promise.resolve({ id: "org-1" }) }
    );

    const call = upsertOrgWhatsAppSettings.mock.calls[0][0];
    expect(call.update).toEqual({
      whatsappAddOnActive: true,
      whatsappMonthlyLimit: 10000,
      whatsappOverageRateCents: 2,
    });
  });

  it("sets/clears suspendedAt from the suspended flag", async () => {
    await PUT(makeRequest({ suspended: true }), { params: Promise.resolve({ id: "org-1" }) });
    expect(upsertOrgWhatsAppSettings.mock.calls[0][0].update.suspendedAt).toBeInstanceOf(Date);

    upsertOrgWhatsAppSettings.mockClear();
    await PUT(makeRequest({ suspended: false }), { params: Promise.resolve({ id: "org-1" }) });
    expect(upsertOrgWhatsAppSettings.mock.calls[0][0].update.suspendedAt).toBeNull();
  });

  it("toggles pilotMode directly", async () => {
    await PUT(makeRequest({ pilotMode: false }), { params: Promise.resolve({ id: "org-1" }) });
    expect(upsertOrgWhatsAppSettings.mock.calls[0][0].update).toEqual({ pilotMode: false });
  });

  it("sets pausedAt and clears pauseReason when unpausing", async () => {
    await PUT(makeRequest({ paused: true, pauseReason: "Investigating opt-out spike" }), { params: Promise.resolve({ id: "org-1" }) });
    let call = upsertOrgWhatsAppSettings.mock.calls[0][0];
    expect(call.update.pausedAt).toBeInstanceOf(Date);
    expect(call.update.pauseReason).toBe("Investigating opt-out spike");

    upsertOrgWhatsAppSettings.mockClear();
    await PUT(makeRequest({ paused: false }), { params: Promise.resolve({ id: "org-1" }) });
    call = upsertOrgWhatsAppSettings.mock.calls[0][0];
    expect(call.update.pausedAt).toBeNull();
    expect(call.update.pauseReason).toBeNull();
  });

  it("updates quiet-hours bounds", async () => {
    await PUT(makeRequest({ quietHoursStartHour: 22, quietHoursEndHour: 7 }), { params: Promise.resolve({ id: "org-1" }) });
    expect(upsertOrgWhatsAppSettings.mock.calls[0][0].update).toEqual({
      quietHoursStartHour: 22,
      quietHoursEndHour: 7,
    });
  });

  it("writes an org-scoped audit event", async () => {
    await PUT(makeRequest({ whatsappAddOnActive: true }), { params: Promise.resolve({ id: "org-1" }) });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "whatsapp_admin.org_settings_updated" })
    );
  });
});

describe("POST /api/admin/whatsapp/organizations/[id]/reset-usage", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    updateOrgWhatsAppSettings.mockReset();
    updateOrgWhatsAppSettings.mockResolvedValue({ id: "settings-1", whatsappUsedThisPeriod: 0 });
    createAuditEvent.mockClear();
  });

  it("requires SUPER_ADMIN", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Permission denied"));
    const response = await resetUsage(new Request("https://x", { method: "POST" }), { params: Promise.resolve({ id: "org-1" }) });
    expect(response.status).toBe(403);
    expect(updateOrgWhatsAppSettings).not.toHaveBeenCalled();
  });

  it("zeroes usage and rolls the billing period forward one month", async () => {
    await resetUsage(new Request("https://x", { method: "POST" }), { params: Promise.resolve({ id: "org-1" }) });

    const call = updateOrgWhatsAppSettings.mock.calls[0][0];
    expect(call.where).toEqual({ organizationId: "org-1" });
    expect(call.data.whatsappUsedThisPeriod).toBe(0);
    expect(call.data.lastUsageThresholdNotified).toBe(0);
    expect(call.data.whatsappBillingPeriodEnd.getTime()).toBeGreaterThan(call.data.whatsappBillingPeriodStart.getTime());
  });

  it("writes an org-scoped audit event", async () => {
    await resetUsage(new Request("https://x", { method: "POST" }), { params: Promise.resolve({ id: "org-1" }) });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", action: "whatsapp_admin.org_usage_reset" })
    );
  });
});
