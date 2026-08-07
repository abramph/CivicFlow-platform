import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database test for resolveMobileAdminCapabilities() — the
 * security-critical function gating the mobile Admin tab. Deliberately NOT
 * using a mocked Prisma client, mirroring this program's own established
 * convention (see entitlement-activation.integration.test.ts from the
 * WhatsApp program): the Labs enrollment gate, the RBAC effective-permission
 * resolution, and the vertical-capability gating all depend on real rows and
 * real cross-table joins that a mocked test can't actually prove work
 * together against real Postgres.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   HOA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/mobile-admin-capabilities.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.HOA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("resolveMobileAdminCapabilities — real Postgres", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let ownerUserId: string;
  let memberUserId: string;
  let enrolledOrgId: string;
  let unenrolledOrgId: string;
  let hoaOrgId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const stamp = Date.now();
    const owner = await prisma.user.create({
      data: { email: `mobile-admin-owner-${stamp}@example.test`, passwordHash: "test-hash-not-real" },
    });
    ownerUserId = owner.id;
    const memberOnly = await prisma.user.create({
      data: { email: `mobile-admin-member-${stamp}@example.test`, passwordHash: "test-hash-not-real" },
    });
    memberUserId = memberOnly.id;

    // billingExempt: true so the mobileAdmin Labs feature's internalOnly
    // ceiling (Stage 1 of the rollout plan) doesn't itself block these tests.
    const enrolledOrg = await prisma.organization.create({
      data: { slug: `mobile-admin-enrolled-${stamp}`, name: "Mobile Admin Enrolled Org", primaryVertical: "COMMUNITY", billingExempt: true },
    });
    enrolledOrgId = enrolledOrg.id;
    const unenrolledOrg = await prisma.organization.create({
      data: { slug: `mobile-admin-unenrolled-${stamp}`, name: "Mobile Admin Unenrolled Org", primaryVertical: "COMMUNITY", billingExempt: true },
    });
    unenrolledOrgId = unenrolledOrg.id;
    const hoaOrg = await prisma.organization.create({
      data: { slug: `mobile-admin-hoa-${stamp}`, name: "Mobile Admin HOA Org", primaryVertical: "HOA", billingExempt: true },
    });
    hoaOrgId = hoaOrg.id;

    await prisma.organizationMembership.create({
      data: { userId: ownerUserId, organizationId: enrolledOrgId, role: "ORG_OWNER", status: "active" },
    });
    await prisma.organizationMembership.create({
      data: { userId: ownerUserId, organizationId: unenrolledOrgId, role: "ORG_OWNER", status: "active" },
    });
    await prisma.organizationMembership.create({
      data: { userId: ownerUserId, organizationId: hoaOrgId, role: "ORG_OWNER", status: "active" },
    });
    // Mixed-role scenario: same physical person, plain MEMBER in a second org.
    await prisma.organizationMembership.create({
      data: { userId: memberUserId, organizationId: enrolledOrgId, role: "MEMBER", status: "active" },
    });

    // Only enrolledOrgId and hoaOrgId are actually enrolled — unenrolledOrgId
    // never gets a row at all, proving the default-deny path.
    await prisma.organizationLabFeature.create({
      data: { organizationId: enrolledOrgId, featureKey: "mobileAdmin", status: "ENABLED", enrollmentSource: "seed" },
    });
    await prisma.organizationLabFeature.create({
      data: { organizationId: hoaOrgId, featureKey: "mobileAdmin", status: "ENABLED", enrollmentSource: "seed" },
    });
  });

  afterAll(async () => {
    const orgIds = [enrolledOrgId, unenrolledOrgId, hoaOrgId];
    await prisma?.organizationLabFeature.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma?.organizationMembership.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await prisma?.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
    await prisma?.user.deleteMany({ where: { id: { in: [ownerUserId, memberUserId] } } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("denies an org that has never been enrolled in mobileAdmin, even for a real ORG_OWNER", async () => {
    const { resolveMobileAdminCapabilities } = await import("@/lib/mobile-admin");
    const result = await resolveMobileAdminCapabilities(unenrolledOrgId, ownerUserId);
    expect(result).toEqual({ available: false, role: null, adminCapabilities: [] });
  });

  it("grants the expected Community-vertical admin capabilities for a real ORG_OWNER once enrolled", async () => {
    const { resolveMobileAdminCapabilities } = await import("@/lib/mobile-admin");
    const result = await resolveMobileAdminCapabilities(enrolledOrgId, ownerUserId);

    expect(result.available).toBe(true);
    expect(result.role).toBe("ORG_OWNER");
    expect(result.adminCapabilities).toEqual(
      expect.arrayContaining(["adminDashboard", "manageMembers", "manageEvents", "manageAttendance", "manageCommunications", "managePayments", "manageReports", "manageOrganization"])
    );
    // Never leaks a PTA/HOA/Union-specific flag onto a Community org.
    expect(result.adminCapabilities).not.toEqual(
      expect.arrayContaining(["managePtaHouseholds", "manageHoaProperties", "manageUnionPayrollCheckoff"])
    );
  });

  it("grants only HOA-relevant flags (never Community-generic ones re-derived from vertical) for a real HOA org officer", async () => {
    const { resolveMobileAdminCapabilities } = await import("@/lib/mobile-admin");
    const result = await resolveMobileAdminCapabilities(hoaOrgId, ownerUserId);

    expect(result.available).toBe(true);
    expect(result.adminCapabilities).toEqual(expect.arrayContaining(["manageHoaProperties", "manageHoaViolations", "manageHoaArchitecturalRequests"]));
  });

  it("denies a plain MEMBER-role account in the same enrolled org — no staff membership means no admin capability regardless of enrollment", async () => {
    const { resolveMobileAdminCapabilities } = await import("@/lib/mobile-admin");
    const result = await resolveMobileAdminCapabilities(enrolledOrgId, memberUserId);
    expect(result).toEqual({ available: false, role: null, adminCapabilities: [] });
  });

  it("resolves independently per organization for the same physical user — mixed-role correctness (Part 21/34)", async () => {
    const { resolveMobileAdminCapabilities } = await import("@/lib/mobile-admin");
    const ownerResult = await resolveMobileAdminCapabilities(enrolledOrgId, ownerUserId);
    const memberResult = await resolveMobileAdminCapabilities(enrolledOrgId, memberUserId);

    expect(ownerResult.available).toBe(true);
    expect(memberResult.available).toBe(false);
  });
});
