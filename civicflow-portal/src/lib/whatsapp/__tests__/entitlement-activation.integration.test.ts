import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Real-database test proving PR D actually closes the gap it exists to
 * close: before this PR, the only way an OrganizationWhatsAppSettings row
 * with whatsappAddOnActive: true could ever be created was a manual SQL
 * insert (see PR C's walkthrough notes) — getWhatsAppEntitlement() denied
 * every org by default. This drives the real PUT /api/admin/whatsapp/
 * organizations/[id] route handler against real Postgres and confirms
 * getWhatsAppEntitlement() actually flips to allowed: true afterward,
 * with the default-filled limit from WHATSAPP_ADDON. A mocked-Prisma test
 * can't prove this — it would just prove the mock was called correctly.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/whatsapp/__tests__/entitlement-activation.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows, and briefly flips the platform-wide
 * PlatformWhatsAppSettings.orgMessagingEnabled toggle (restored in afterAll).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

const session = { userId: "", userEmail: "whatsapp-activation-test@example.test" };

vi.mock("@/lib/auth-guards", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guards")>("@/lib/auth-guards");
  return { ...actual, requireSuperAdmin: async () => ({ session }) };
});

describe.skipIf(!RUN_INTEGRATION)("WhatsApp org activation — real Postgres", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawPrisma: any;
  let orgId: string;
  let adminUserId: string;
  let originalOrgMessagingEnabled: boolean;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    rawPrisma = new PrismaClient();

    const stamp = Date.now();
    const admin = await rawPrisma.user.create({
      data: { email: `whatsapp-activation-admin-${stamp}@example.test`, passwordHash: "test-hash-not-real" },
    });
    adminUserId = admin.id;
    session.userId = adminUserId;

    const org = await rawPrisma.organization.create({
      data: { slug: `whatsapp-activation-${stamp}`, name: "WhatsApp Activation Test Org", primaryVertical: "COMMUNITY" },
    });
    orgId = org.id;

    await rawPrisma.subscription.create({
      data: { organizationId: orgId, plan: "standard", status: "active" },
    });

    const { getPlatformWhatsAppSettings, updatePlatformWhatsAppSettings } = await import("@/lib/whatsapp/credentials");
    const platformSettings = await getPlatformWhatsAppSettings();
    originalOrgMessagingEnabled = platformSettings.orgMessagingEnabled;
    if (!originalOrgMessagingEnabled) {
      await updatePlatformWhatsAppSettings({ orgMessagingEnabled: true }, adminUserId);
    }
  });

  afterAll(async () => {
    if (!originalOrgMessagingEnabled) {
      const { updatePlatformWhatsAppSettings } = await import("@/lib/whatsapp/credentials");
      await updatePlatformWhatsAppSettings({ orgMessagingEnabled: false }, adminUserId).catch(() => {});
    }
    await rawPrisma?.auditEvent.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    // Subscription and OrganizationWhatsAppSettings both cascade-delete with the Organization.
    await rawPrisma?.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await rawPrisma?.user.deleteMany({ where: { id: adminUserId } }).catch(() => {});
    await rawPrisma?.$disconnect();
  });

  it("denies the org before any OrganizationWhatsAppSettings row exists", async () => {
    const { getWhatsAppEntitlement } = await import("@/lib/whatsapp/entitlement");
    const entitlement = await getWhatsAppEntitlement(orgId);
    expect(entitlement.allowed).toBe(false);
    expect(entitlement.reason).toMatch(/add-on/i);
  });

  it("activating via the admin route makes getWhatsAppEntitlement allow the org, with the default-filled limit", async () => {
    const { PUT } = await import("@/app/api/admin/whatsapp/organizations/[id]/route");
    const request = new Request(`https://x/api/admin/whatsapp/organizations/${orgId}`, {
      method: "PUT",
      body: JSON.stringify({ whatsappAddOnActive: true }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: orgId }) });
    expect(response.status).toBe(200);

    const { getWhatsAppEntitlement } = await import("@/lib/whatsapp/entitlement");
    const { WHATSAPP_ADDON } = await import("@/lib/whatsapp/pricing");
    const entitlement = await getWhatsAppEntitlement(orgId);

    expect(entitlement.allowed).toBe(true);
    expect(entitlement.limit).toBe(WHATSAPP_ADDON.includedMessagesPerMonth);
    expect(entitlement.remaining).toBe(WHATSAPP_ADDON.includedMessagesPerMonth);
  });

  it("suspending the org through the same route denies it again without deactivating the add-on", async () => {
    const { PUT } = await import("@/app/api/admin/whatsapp/organizations/[id]/route");
    const request = new Request(`https://x/api/admin/whatsapp/organizations/${orgId}`, {
      method: "PUT",
      body: JSON.stringify({ suspended: true }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: orgId }) });
    expect(response.status).toBe(200);

    const { getWhatsAppEntitlement } = await import("@/lib/whatsapp/entitlement");
    const entitlement = await getWhatsAppEntitlement(orgId);

    expect(entitlement.allowed).toBe(false);
    expect(entitlement.reason).toMatch(/suspended/i);
  });
});
