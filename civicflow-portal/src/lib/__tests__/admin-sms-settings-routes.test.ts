import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSuperAdmin = vi.fn();
vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: (...args: unknown[]) => requireSuperAdmin(...args) };
});

const createAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }));

const findFirstPlatformSmsSettings = vi.fn();
const updatePlatformSmsSettings = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformSmsSettings: {
      findFirst: (...args: unknown[]) => findFirstPlatformSmsSettings(...args),
      create: (...args: unknown[]) => findFirstPlatformSmsSettings.mockResolvedValue(args), // unused in these tests
      update: (...args: unknown[]) => updatePlatformSmsSettings(...args),
    },
  },
}));

vi.mock("@/lib/crypto-secrets", () => ({
  encryptSecret: (value: string) => `enc:${value}`,
  decryptSecret: (value: string) => value.replace(/^enc:/, ""),
  maskSecret: (value: string) => `masked:${value.slice(-4)}`,
}));

import { GET as getSettings, PUT as putSettings } from "@/app/api/admin/sms/settings/route";
import { PUT as putCredentials } from "@/app/api/admin/sms/credentials/route";

const session = { userId: "user-1", userEmail: "admin@example.com" };

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "settings-1",
    platformEnabled: false,
    testMode: true,
    maintenanceMode: false,
    outboundPaused: false,
    mfaSmsEnabled: true,
    orgMessagingEnabled: false,
    testPhoneNumbers: [],
    carrierFeePercent: 0,
    accountSidEncrypted: null,
    authTokenEncrypted: null,
    apiKeyEncrypted: null,
    apiSecretEncrypted: null,
    messagingServiceSidEncrypted: null,
    tollFreeNumberEncrypted: null,
    verifyServiceSidEncrypted: null,
    tollFreeVerificationStatus: "NOT_SUBMITTED",
    tollFreeVerificationSubmittedAt: null,
    tollFreeVerificationApprovedAt: null,
    tollFreeVerificationLastCheckedAt: null,
    ...overrides,
  };
}

describe("GET /api/admin/sms/settings", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    findFirstPlatformSmsSettings.mockReset();
    createAuditEvent.mockClear();
  });

  it("requires SUPER_ADMIN", async () => {
    const { ForbiddenError } = await import("@/lib/auth-guards");
    requireSuperAdmin.mockRejectedValueOnce(new ForbiddenError("Permission denied"));
    const response = await getSettings();
    expect(response.status).toBe(403);
  });

  it("returns toggles and a masked credentials view", async () => {
    requireSuperAdmin.mockResolvedValueOnce({ session });
    findFirstPlatformSmsSettings.mockResolvedValueOnce(baseSettings({ platformEnabled: true }));

    const response = await getSettings();
    const payload = await response.json();

    expect(payload.ok).toBe(true);
    expect(payload.data.platformEnabled).toBe(true);
    expect(payload.data.credentials.source).toBe("unconfigured");
  });
});

describe("PUT /api/admin/sms/settings", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    findFirstPlatformSmsSettings.mockReset();
    updatePlatformSmsSettings.mockReset();
    createAuditEvent.mockClear();
  });

  it("updates toggles and writes a platform-level audit event (organizationId: null)", async () => {
    requireSuperAdmin.mockResolvedValueOnce({ session });
    findFirstPlatformSmsSettings.mockResolvedValueOnce(baseSettings());
    updatePlatformSmsSettings.mockResolvedValueOnce(baseSettings({ platformEnabled: true }));

    const request = new Request("https://x/api/admin/sms/settings", {
      method: "PUT",
      body: JSON.stringify({ platformEnabled: true }),
    });
    const response = await putSettings(request);
    const payload = await response.json();

    expect(payload.data.platformEnabled).toBe(true);
    expect(updatePlatformSmsSettings).toHaveBeenCalledWith({
      where: { id: "settings-1" },
      data: { platformEnabled: true, updatedByUserId: "user-1" },
    });
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, action: "sms_admin.settings_updated" })
    );
  });
});

describe("PUT /api/admin/sms/credentials", () => {
  beforeEach(() => {
    requireSuperAdmin.mockReset();
    findFirstPlatformSmsSettings.mockReset();
    updatePlatformSmsSettings.mockReset();
    createAuditEvent.mockClear();
  });

  it("encrypts submitted credentials and never returns plaintext", async () => {
    requireSuperAdmin.mockResolvedValueOnce({ session });
    findFirstPlatformSmsSettings.mockResolvedValue(baseSettings());
    updatePlatformSmsSettings.mockResolvedValueOnce(undefined);
    // Second findFirst call (inside getMaskedSmsCredentialsView) returns updated state:
    findFirstPlatformSmsSettings.mockResolvedValueOnce(baseSettings()).mockResolvedValueOnce(
      baseSettings({ accountSidEncrypted: "enc:AC1234567890abcdef" })
    );

    const request = new Request("https://x/api/admin/sms/credentials", {
      method: "PUT",
      body: JSON.stringify({ accountSid: "AC1234567890abcdef" }),
    });
    const response = await putCredentials(request);
    const payload = await response.json();
    const raw = JSON.stringify(payload);

    expect(raw).not.toContain("AC1234567890abcdef");
    expect(payload.data.accountSid).toBe("masked:cdef");
    expect(createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sms_admin.credentials_updated", metadata: { fieldsUpdated: ["accountSid"] } })
    );
  });
});
