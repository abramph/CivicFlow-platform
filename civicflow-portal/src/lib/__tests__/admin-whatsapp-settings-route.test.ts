import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const getMaskedWhatsAppSettingsView = vi.fn();
const getPlatformWhatsAppSettings = vi.fn();
const updatePlatformWhatsAppSettings = vi.fn();
vi.mock("@/lib/whatsapp/credentials", () => ({
  getMaskedWhatsAppSettingsView: (...args: unknown[]) => getMaskedWhatsAppSettingsView(...args),
  getPlatformWhatsAppSettings: (...args: unknown[]) => getPlatformWhatsAppSettings(...args),
  updatePlatformWhatsAppSettings: (...args: unknown[]) => updatePlatformWhatsAppSettings(...args),
}));

import { GET, PUT } from "@/app/api/admin/whatsapp/settings/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };

const maskedView = {
  fromNumber: "+14155238886",
  messagingServiceSid: null,
  accountSidMasked: "***cdef",
  senderSource: "database" as const,
  platformEnabled: true,
  sandboxMode: true,
  maintenanceMode: false,
  outboundPaused: false,
  orgMessagingEnabled: false,
  testPhoneNumbers: ["+15551112222"],
};

describe("GET /api/admin/whatsapp/settings", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    getMaskedWhatsAppSettingsView.mockReset();
  });

  it("requires SUPER_ADMIN", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Permission denied"));
    const response = await GET();
    expect(response.status).toBe(403);
    expect(getMaskedWhatsAppSettingsView).not.toHaveBeenCalled();
  });

  it("returns the masked settings view", async () => {
    requireSuperAdmin.mockResolvedValueOnce({ session });
    getMaskedWhatsAppSettingsView.mockResolvedValueOnce(maskedView);

    const response = await GET();
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual(maskedView);
    expect(JSON.stringify(payload)).not.toContain("authToken");
  });
});

describe("PUT /api/admin/whatsapp/settings", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    requireSuperAdmin.mockResolvedValue({ session });
    getMaskedWhatsAppSettingsView.mockReset();
    getMaskedWhatsAppSettingsView.mockResolvedValue(maskedView);
    getPlatformWhatsAppSettings.mockReset();
    getPlatformWhatsAppSettings.mockResolvedValue({ id: "wa-settings-1" });
    updatePlatformWhatsAppSettings.mockReset();
    updatePlatformWhatsAppSettings.mockResolvedValue(undefined);
    createAuditEvent.mockClear();
  });

  it("requires SUPER_ADMIN", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Permission denied"));
    const request = new Request("https://x/api/admin/whatsapp/settings", { method: "PUT", body: JSON.stringify({ maintenanceMode: true }) });
    const response = await PUT(request);
    expect(response.status).toBe(403);
    expect(updatePlatformWhatsAppSettings).not.toHaveBeenCalled();
  });

  it("passes the parsed input straight through to updatePlatformWhatsAppSettings", async () => {
    const request = new Request("https://x/api/admin/whatsapp/settings", {
      method: "PUT",
      body: JSON.stringify({ maintenanceMode: true, testPhoneNumbers: ["+15551112222"] }),
    });
    await PUT(request);

    expect(updatePlatformWhatsAppSettings).toHaveBeenCalledWith(
      { maintenanceMode: true, testPhoneNumbers: ["+15551112222"] },
      "user-1"
    );
  });

  it("writes a platform-level audit event naming only the changed fields, never values", async () => {
    const request = new Request("https://x/api/admin/whatsapp/settings", {
      method: "PUT",
      body: JSON.stringify({ fromNumber: "+15559998888", maintenanceMode: true }),
    });
    await PUT(request);

    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        action: "whatsapp_admin.settings_updated",
        metadata: { fields: ["fromNumber", "maintenanceMode"] },
      })
    );
    const auditCall = createAuditEvent.mock.calls[0][0];
    expect(JSON.stringify(auditCall)).not.toContain("+15559998888");
  });

  it("returns the refreshed masked view", async () => {
    const request = new Request("https://x/api/admin/whatsapp/settings", { method: "PUT", body: JSON.stringify({ sandboxMode: false }) });
    const response = await PUT(request);
    const payload = await response.json();
    expect(payload.data).toEqual(maskedView);
  });
});
