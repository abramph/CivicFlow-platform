import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Real-database test for the highest-risk scenario in this feature: a parent
 * belonging to two PTA organizations must see the correct dues for each,
 * with zero leakage, and a guessed charge/household id from the other
 * organization must be denied even though the caller is a genuine,
 * authenticated user (just not a member of that org's household).
 *
 * Skipped by default — run with DATABASE_URL pointed at a disposable/local
 * Postgres BEFORE starting vitest, e.g.:
 *   DATABASE_URL="postgresql://postgres@localhost:55432/civicflow_disposable" \
 *   PTA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/__tests__/parent-dues-multi-org.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_RUN_DB_INTEGRATION_TEST === "1";

describe.skipIf(!RUN_INTEGRATION)("Parent dues self-service — real multi-org isolation", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let userId: string;
  let orgAId: string;
  let orgBId: string;
  let householdAId: string;
  let householdBId: string;
  let chargeAId: string;
  let chargeBId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const user = await prisma.user.create({ data: { email: `pta-parent-dues-test-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    userId = user.id;

    const orgA = await prisma.organization.create({ data: { slug: `pta-parent-dues-a-${Date.now()}`, name: "Parent Dues Test Org A", plan: "elite" } });
    const orgB = await prisma.organization.create({ data: { slug: `pta-parent-dues-b-${Date.now()}`, name: "Parent Dues Test Org B", plan: "elite" } });
    orgAId = orgA.id;
    orgBId = orgB.id;

    await prisma.organizationLabFeature.create({ data: { organizationId: orgAId, featureKey: "ptaVertical", status: "ENABLED", enrollmentSource: "seed" } });
    await prisma.organizationLabFeature.create({ data: { organizationId: orgBId, featureKey: "ptaVertical", status: "ENABLED", enrollmentSource: "seed" } });
    await prisma.organizationMembership.create({ data: { organizationId: orgAId, userId, role: "MEMBER", status: "active", joinedAt: new Date() } });
    await prisma.organizationMembership.create({ data: { organizationId: orgBId, userId, role: "MEMBER", status: "active", joinedAt: new Date() } });

    const orgMemberA = await prisma.orgMember.create({ data: { organizationId: orgAId, firstName: "Household A", lastName: "(PTA)", householdName: "Household A" } });
    const orgMemberB = await prisma.orgMember.create({ data: { organizationId: orgBId, firstName: "Household B", lastName: "(PTA)", householdName: "Household B" } });

    const householdA = await prisma.ptaHousehold.create({ data: { organizationId: orgAId, displayName: "Household A", schoolYear: "2026-2027", orgMemberId: orgMemberA.id } });
    const householdB = await prisma.ptaHousehold.create({ data: { organizationId: orgBId, displayName: "Household B", schoolYear: "2026-2027", orgMemberId: orgMemberB.id } });
    householdAId = householdA.id;
    householdBId = householdB.id;

    await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgAId, householdId: householdA.id, name: "Multi-Org Parent", userId } });
    await prisma.ptaHouseholdAdult.create({ data: { organizationId: orgBId, householdId: householdB.id, name: "Multi-Org Parent", userId } });

    const duesAccountA = await prisma.duesAccount.create({ data: { organizationId: orgAId, memberId: orgMemberA.id, name: "PTA Membership Dues" } });
    const duesAccountB = await prisma.duesAccount.create({ data: { organizationId: orgBId, memberId: orgMemberB.id, name: "PTA Membership Dues" } });

    const chargeA = await prisma.duesCharge.create({
      data: { organizationId: orgAId, memberId: orgMemberA.id, duesAccountId: duesAccountA.id, amountDue: 25, dueDate: new Date("2026-09-01"), periodStart: new Date("2026-08-01"), periodEnd: new Date("2099-06-30"), status: "PENDING" },
    });
    const chargeB = await prisma.duesCharge.create({
      data: { organizationId: orgBId, memberId: orgMemberB.id, duesAccountId: duesAccountB.id, amountDue: 40, dueDate: new Date("2026-09-01"), periodStart: new Date("2026-08-01"), periodEnd: new Date("2099-06-30"), status: "PAID", amountPaid: 40 },
    });
    chargeAId = chargeA.id;
    chargeBId = chargeB.id;
  });

  afterAll(async () => {
    await prisma?.organization.delete({ where: { id: orgAId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgBId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  it("the same parent sees the CORRECT, DIFFERENT dues summary in each organization", async () => {
    const { getPtaParentDuesSummary } = await import("../parent-dues");

    const summaryA = await getPtaParentDuesSummary(orgAId, householdAId);
    const summaryB = await getPtaParentDuesSummary(orgBId, householdBId);

    expect(summaryA.currentCharge?.amountDueCents).toBe(2500);
    expect(summaryA.currentCharge?.status).toBe("UNPAID");
    expect(summaryB.currentCharge?.amountDueCents).toBe(4000);
    expect(summaryB.currentCharge?.status).toBe("PAID");
  });

  it("querying org A with org B's household id is denied, not silently redirected", async () => {
    const { getPtaParentDuesSummary } = await import("../parent-dues");
    await expect(getPtaParentDuesSummary(orgAId, householdBId)).rejects.toMatchObject({ code: "PTA_HOUSEHOLD_NOT_FOUND" });
  });

  it("a guessed charge id from org B cannot be used to report a payment against org A's household", async () => {
    const { reportPtaDuesPayment } = await import("../parent-dues");
    await expect(
      reportPtaDuesPayment({ organizationId: orgAId, householdId: householdAId, actorUserId: userId, duesChargeId: chargeBId, amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() })
    ).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });
  });

  it("reporting a real payment against org A's own charge succeeds and creates a real, tenant-scoped PaymentReport", async () => {
    const { reportPtaDuesPayment } = await import("../parent-dues");
    const report = await reportPtaDuesPayment({ organizationId: orgAId, householdId: householdAId, actorUserId: userId, duesChargeId: chargeAId, amountCents: 2500, paymentMethod: "CASH", paymentDate: new Date() });
    expect(report.organizationId).toBe(orgAId);

    const fetched = await prisma.paymentReport.findUnique({ where: { id: report.id } });
    expect(fetched.organizationId).toBe(orgAId);
    expect(fetched.duesChargeId).toBe(chargeAId);
    expect(fetched.status).toBe("pending");
  });
});
