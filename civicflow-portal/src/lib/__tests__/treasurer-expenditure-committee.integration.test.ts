import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSafeTestDatabaseUrl } from "./test-db-safety";

/**
 * feature/pta-treasurer-expenditure-experience (E3) — real-database proof
 * for the new committee-attribution migration and its dependent behavior:
 * the FK is genuinely enforced, cross-org/cross-vertical committee use is
 * rejected, a committee rename or deletion never alters or destroys a
 * historical Expenditure, reimbursement mark-paid genuinely inherits and
 * snapshots the committee, the void CAS guard holds under real concurrency,
 * a forced audit failure genuinely rolls back the void, and a correction
 * (void/reverse) genuinely preserves the original attribution. Mirrors
 * reimbursements-payment-concurrency.integration.test.ts's structure and
 * safety-gate convention exactly.
 *
 * This file reads ONLY a dedicated `PTA_TREASURER_TEST_DATABASE_URL` var —
 * never the ambient `DATABASE_URL` — and refuses to run at all against
 * anything that isn't an obviously-disposable loopback database (see
 * test-db-safety.ts). It never prints the connection string.
 *
 * One-time local setup required before this can run (reuses the same
 * disposable role/database as every other Treasurer integration suite in
 * this repo — no new credential of any kind is embedded here or guessed):
 *   PTA_TREASURER_TEST_DATABASE_URL="postgresql://civicflow_treasurer_test:PASSWORD@localhost:5432/civicflow_treasurer_integration_test" \
 *   PTA_TREASURER_EXPENDITURE_COMMITTEE_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/treasurer-expenditure-committee.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const target = resolveSafeTestDatabaseUrl("PTA_TREASURER_TEST_DATABASE_URL", "treasurer_integration_test");
const RUN_INTEGRATION = target !== null && process.env.PTA_TREASURER_EXPENDITURE_COMMITTEE_RUN_DB_INTEGRATION_TEST === "1";
if (RUN_INTEGRATION && target) process.env.DATABASE_URL = target.url;

// Same standard pattern used throughout this program's integration suites:
// importOriginal() resolves the real module ONCE at mock-setup time, and
// the mock defaults to it via vi.fn(actual.fn) -- only the one test that
// needs to simulate an audit failure overrides it, per-test.
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return { ...actual, createAuditEvent: vi.fn(actual.createAuditEvent) };
});

describe.skipIf(!RUN_INTEGRATION)("Expenditure committee attribution — real database", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let expenditures: typeof import("@/lib/expenditures");
  let reimbursements: typeof import("@/lib/reimbursements");
  let orgId: string;
  let otherOrgId: string;
  let communityOrgId: string;
  let submitterId: string;
  let managerId: string;
  let categoryId: string;
  let paymentMethodId: string;
  let committeeId: string;
  let otherOrgCommitteeId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    expenditures = await import("@/lib/expenditures");
    reimbursements = await import("@/lib/reimbursements");

    const org = await prisma.organization.create({ data: { slug: `pta-committee-${Date.now()}`, name: "Committee Attribution Test PTA", primaryVertical: "PTA" } });
    orgId = org.id;
    const otherOrg = await prisma.organization.create({ data: { slug: `pta-committee-other-${Date.now()}`, name: "Other PTA", primaryVertical: "PTA" } });
    otherOrgId = otherOrg.id;
    const communityOrg = await prisma.organization.create({ data: { slug: `community-committee-${Date.now()}`, name: "Non-PTA Org", primaryVertical: "COMMUNITY" } });
    communityOrgId = communityOrg.id;

    const submitter = await prisma.user.create({ data: { email: `committee-submitter-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    submitterId = submitter.id;
    const manager = await prisma.user.create({ data: { email: `committee-manager-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    managerId = manager.id;

    const category = await prisma.category.create({ data: { organizationId: orgId, name: "Supplies", type: "EXPENDITURE" } });
    categoryId = category.id;
    const method = await prisma.paymentMethodConfig.create({ data: { organizationId: orgId, method: "CHECK", label: "Check", isActive: true } });
    paymentMethodId = method.id;

    const committee = await prisma.ptaCommittee.create({ data: { organizationId: orgId, name: "Fundraising" } });
    committeeId = committee.id;
    const otherOrgCommittee = await prisma.ptaCommittee.create({ data: { organizationId: otherOrgId, name: "Other Org Committee" } });
    otherOrgCommitteeId = otherOrgCommittee.id;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // ReimbursementRequest before Expenditure -- same FK-order note as the
    // reimbursement concurrency suite (PAID rows point at their Expenditure
    // via a SetNull FK; deleting the Expenditure first would null that FK
    // while status is still 'PAID', violating the PAID-requires-expenditure
    // CHECK constraint).
    await prisma?.reimbursementRequest.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma?.expenditure.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
    await prisma?.auditEvent.deleteMany({ where: { organizationId: { in: [orgId, otherOrgId] } } });
  });

  it("the committee FK is genuinely enforced -- a direct insert referencing a nonexistent committee is rejected", async () => {
    let rejected = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Expenditure" (id, "organizationId", description, amount, date, "committeeId", "createdAt", "updatedAt") VALUES ($1, $2, 'x', 1.00, now(), $3, now(), now())`,
        `committee-fk-test-${Date.now()}`,
        orgId,
        "nonexistent-committee-id"
      );
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("Expenditure_committeeId_fkey");
    }
    expect(rejected).toBe(true);
  });

  it("accepts a same-organization committee and rejects a cross-organization one", async () => {
    const accepted = await expenditures.assertCommitteeInOrganization(orgId, committeeId);
    expect(accepted).toMatchObject({ id: committeeId, name: "Fundraising" });

    await expect(expenditures.assertCommitteeInOrganization(orgId, otherOrgCommitteeId)).rejects.toMatchObject({ status: 404 });
  });

  it("a non-PTA organization cannot use a PTA committee id, even one that genuinely exists elsewhere", async () => {
    await expect(expenditures.assertCommitteeInOrganization(communityOrgId, committeeId)).rejects.toMatchObject({ status: 404 });
    expect(await expenditures.getOrganizationCommitteeOptions(communityOrgId, "COMMUNITY")).toEqual([]);
  });

  it("renaming a committee never alters an already-posted expenditure's snapshot", async () => {
    const renameCommittee = await prisma.ptaCommittee.create({ data: { organizationId: orgId, name: "Original Name" } });
    const expenditure = await prisma.expenditure.create({
      data: { organizationId: orgId, description: "Snapshot test", amount: 10, date: new Date(), committeeId: renameCommittee.id, committeeNameAtPosting: "Original Name" },
    });

    await prisma.ptaCommittee.update({ where: { id: renameCommittee.id }, data: { name: "Renamed Committee" } });

    const reloaded = await prisma.expenditure.findFirst({ where: { id: expenditure.id }, include: { committee: true } });
    expect(reloaded.committeeNameAtPosting).toBe("Original Name");
    expect(reloaded.committee.name).toBe("Renamed Committee");

    await prisma.expenditure.delete({ where: { id: expenditure.id } });
    await prisma.ptaCommittee.delete({ where: { id: renameCommittee.id } });
  });

  it("deleting a committee sets committeeId to null via the FK but preserves the snapshot and the Expenditure row itself", async () => {
    const deletableCommittee = await prisma.ptaCommittee.create({ data: { organizationId: orgId, name: "About To Be Deleted" } });
    const expenditure = await prisma.expenditure.create({
      data: { organizationId: orgId, description: "Deletion test", amount: 25, date: new Date(), committeeId: deletableCommittee.id, committeeNameAtPosting: "About To Be Deleted" },
    });

    await prisma.ptaCommittee.delete({ where: { id: deletableCommittee.id } });

    const reloaded = await prisma.expenditure.findFirst({ where: { id: expenditure.id } });
    expect(reloaded).not.toBeNull();
    expect(reloaded.committeeId).toBeNull();
    expect(reloaded.committeeNameAtPosting).toBe("About To Be Deleted");

    await prisma.expenditure.delete({ where: { id: expenditure.id } });
  });

  it("reimbursement mark-paid inherits committeeId and snapshots the committee's current name", async () => {
    const request = await prisma.reimbursementRequest.create({
      data: { organizationId: orgId, submittedByUserId: submitterId, payeeName: "Casey Chair", description: "Bake sale supplies", amount: "15.00", categoryId, committeeId, status: "APPROVED" },
    });

    const result = await reimbursements.transitionReimbursement({
      organizationId: orgId,
      requestId: request.id,
      status: "PAID",
      paymentMethodId,
      actorUserId: managerId,
    });

    const expenditure = await prisma.expenditure.findFirst({ where: { id: result.expenditureId } });
    expect(expenditure.committeeId).toBe(committeeId);
    expect(expenditure.committeeNameAtPosting).toBe("Fundraising");
  });

  it("void and reversal preserve the original committee attribution", async () => {
    const request = await prisma.reimbursementRequest.create({
      data: { organizationId: orgId, submittedByUserId: submitterId, payeeName: "Casey Chair", description: "Field trip snacks", amount: "20.00", categoryId, committeeId, status: "APPROVED" },
    });
    const paid = await reimbursements.transitionReimbursement({ organizationId: orgId, requestId: request.id, status: "PAID", paymentMethodId, actorUserId: managerId });

    await reimbursements.transitionReimbursement({
      organizationId: orgId,
      requestId: request.id,
      status: "VOIDED",
      correctionReason: "Marked paid by mistake",
      confirmText: "VOID",
      actorUserId: managerId,
    });

    const expenditure = await prisma.expenditure.findFirst({ where: { id: paid.expenditureId } });
    expect(expenditure.voidedAt).not.toBeNull();
    expect(expenditure.committeeId).toBe(committeeId);
    expect(expenditure.committeeNameAtPosting).toBe("Fundraising");
  });

  it("two concurrent void requests on the same expenditure produce exactly one voided outcome and one audit event", async () => {
    const expenditure = await prisma.expenditure.create({
      data: { organizationId: orgId, description: "Concurrency test", amount: 30, date: new Date() },
    });

    const outcomes = await Promise.allSettled([
      expenditures.voidExpenditure({ organizationId: orgId, expenditureId: expenditure.id, reason: "Attempt A", actorUserId: managerId, existing: expenditure }),
      expenditures.voidExpenditure({ organizationId: orgId, expenditureId: expenditure.id, reason: "Attempt B", actorUserId: managerId, existing: expenditure }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    const auditCount = await prisma.auditEvent.count({ where: { organizationId: orgId, resource: "expenditure", resourceId: expenditure.id, action: "void" } });
    expect(auditCount).toBe(1);

    await prisma.expenditure.delete({ where: { id: expenditure.id } });
  });

  it("a forced audit failure rolls back the void -- the expenditure remains un-voided", async () => {
    const expenditure = await prisma.expenditure.create({
      data: { organizationId: orgId, description: "Audit rollback test", amount: 40, date: new Date() },
    });

    const { createAuditEvent } = await import("@/lib/audit");
    vi.mocked(createAuditEvent).mockRejectedValueOnce(new Error("Simulated audit-write failure"));

    await expect(
      expenditures.voidExpenditure({ organizationId: orgId, expenditureId: expenditure.id, reason: "Should roll back", actorUserId: managerId, existing: expenditure })
    ).rejects.toThrow("Simulated audit-write failure");

    const reloaded = await prisma.expenditure.findFirst({ where: { id: expenditure.id } });
    expect(reloaded.voidedAt).toBeNull();
    expect(reloaded.voidReason).toBeNull();

    await prisma.expenditure.delete({ where: { id: expenditure.id } });
  });
});
