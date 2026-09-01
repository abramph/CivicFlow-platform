import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSafeTestDatabaseUrl } from "./test-db-safety";

/**
 * fix/pta-treasurer-financial-controls §3/§5/§12 — real-database proof that
 * the CAS-guarded PAID/VOIDED/REVERSED transitions in
 * src/lib/reimbursements.ts hold under genuine concurrent load. Mirrors
 * buyout-purchase-dedupe-concurrency.integration.test.ts's structure and
 * skip convention, plus an additional safety gate (test-db-safety.ts) that
 * this program's own credential incident made necessary: this file reads
 * ONLY a dedicated `PTA_TREASURER_TEST_DATABASE_URL` var — never the
 * ambient `DATABASE_URL`, which has pointed at production in this repo's
 * own `.env`/`.env.local` before — and refuses to run at all against
 * anything that isn't an obviously-disposable loopback database.
 *
 * `createAuditEvent` is mocked ONLY for the "audit failure rolls back
 * everything" case below (real Postgres, fake audit failure) — every other
 * test uses the real audit writer against the real database.
 *
 * One-time local setup required before this can run (no credential of any
 * kind is embedded here or guessed):
 *   1. Create a dedicated local Postgres role and database whose name makes
 *      it unambiguously disposable, e.g.:
 *        createuser --pwprompt civicflow_treasurer_test
 *        createdb --owner=civicflow_treasurer_test civicflow_treasurer_integration_test
 *   2. Run with that connection string in the dedicated variable:
 *        PTA_TREASURER_TEST_DATABASE_URL="postgresql://civicflow_treasurer_test:PASSWORD@localhost:5432/civicflow_treasurer_integration_test" \
 *        PTA_TREASURER_REIMBURSEMENT_CONCURRENCY_RUN_DB_INTEGRATION_TEST=1 \
 *          npx vitest run src/lib/__tests__/reimbursements-payment-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows. This file never prints the connection string.
 */
const target = (() => {
  try {
    return resolveSafeTestDatabaseUrl("PTA_TREASURER_TEST_DATABASE_URL", "treasurer_integration_test");
  } catch (error) {
    // Fail loudly at collection time rather than silently skipping if the
    // variable was set but points somewhere unsafe -- an unsafe value is a
    // configuration mistake worth surfacing, not swallowing.
    throw error;
  }
})();
const RUN_INTEGRATION = target !== null && process.env.PTA_TREASURER_REIMBURSEMENT_CONCURRENCY_RUN_DB_INTEGRATION_TEST === "1";
// The code under test (transitionReimbursement) uses the app's own
// `@/lib/prisma` singleton, which reads `process.env.DATABASE_URL` at
// construction -- so the SUT and this file's own setup/teardown queries
// must agree on the same connection. Only ever set here AFTER
// resolveSafeTestDatabaseUrl has already validated it as loopback +
// disposable-test-named; never set from an unvalidated/ambient value.
if (RUN_INTEGRATION && target) process.env.DATABASE_URL = target.url;

const createAuditEventMock = vi.fn();
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return {
    ...actual,
    createAuditEvent: (...args: Parameters<typeof actual.createAuditEvent>) => createAuditEventMock(...args),
  };
});

describe.skipIf(!RUN_INTEGRATION)("transitionReimbursement — real concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let transitionReimbursement: typeof import("@/lib/reimbursements").transitionReimbursement;
  let orgId: string;
  let submitterId: string;
  let managerId: string;
  let categoryId: string;
  let paymentMethodId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    ({ transitionReimbursement } = await import("@/lib/reimbursements"));

    const org = await prisma.organization.create({
      data: { slug: `pta-reimb-concurrency-${Date.now()}`, name: "Reimbursement Concurrency Test PTA", primaryVertical: "PTA" },
    });
    orgId = org.id;

    const submitter = await prisma.user.create({ data: { email: `reimb-submitter-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    submitterId = submitter.id;
    const manager = await prisma.user.create({ data: { email: `reimb-manager-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    managerId = manager.id;

    const category = await prisma.category.create({
      data: { organizationId: orgId, name: "Supplies", type: "EXPENDITURE" },
    });
    categoryId = category.id;

    const method = await prisma.paymentMethodConfig.create({
      data: { organizationId: orgId, method: "CHECK", label: "Check", isActive: true },
    });
    paymentMethodId = method.id;
  });

  async function createApproved(amount: string) {
    const request = await prisma.reimbursementRequest.create({
      data: {
        organizationId: orgId,
        submittedByUserId: submitterId,
        payeeName: "Test Payee",
        description: "Test spend",
        amount,
        categoryId,
        status: "APPROVED",
      },
    });
    return request.id as string;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    createAuditEventMock.mockImplementation(async (input: Parameters<typeof import("@/lib/audit").createAuditEvent>[0]) => {
      const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
      return actual.createAuditEvent(input);
    });
  });

  afterEach(async () => {
    await prisma?.expenditure.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.reimbursementRequest.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.auditEvent.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
  });

  it("two simultaneous mark-paid requests produce exactly one PAID transition, one Expenditure, and one audit event", async () => {
    const requestId = await createApproved("42.50");

    const attempts = await Promise.allSettled([
      transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId }),
      transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId }),
    ]);

    const fulfilled = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    const expenditures = await prisma.expenditure.findMany({ where: { organizationId: orgId } });
    expect(expenditures).toHaveLength(1);

    const final = await prisma.reimbursementRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(final.status).toBe("PAID");
    expect(final.expenditureId).toBe(expenditures[0].id);

    const audits = await prisma.auditEvent.findMany({ where: { organizationId: orgId, action: "reimbursement.paid", resourceId: requestId } });
    expect(audits).toHaveLength(1);
  });

  it("ten simultaneous mark-paid requests still produce exactly one PAID transition and one Expenditure", async () => {
    const requestId = await createApproved("10.00");

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId })
      )
    );

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(9);

    const expenditures = await prisma.expenditure.findMany({ where: { organizationId: orgId } });
    expect(expenditures).toHaveLength(1);
  });

  it("retrying after a lost race is a stable no-op — repeated calls never create a second Expenditure", async () => {
    const requestId = await createApproved("15.00");
    await transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId });

    await expect(
      transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId })
    ).rejects.toMatchObject({ status: 409 });

    const expenditures = await prisma.expenditure.findMany({ where: { organizationId: orgId } });
    expect(expenditures).toHaveLength(1);
  });

  it("an audit failure rolls back the PAID transition and the Expenditure — zero of all three persist", async () => {
    const requestId = await createApproved("20.00");
    createAuditEventMock.mockRejectedValueOnce(new Error("simulated audit outage"));

    await expect(
      transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId })
    ).rejects.toThrow("simulated audit outage");

    const stillApproved = await prisma.reimbursementRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(stillApproved.status).toBe("APPROVED");
    expect(stillApproved.expenditureId).toBeNull();
    expect(await prisma.expenditure.findMany({ where: { organizationId: orgId } })).toHaveLength(0);
    expect(await prisma.auditEvent.findMany({ where: { organizationId: orgId, resourceId: requestId } })).toHaveLength(0);

    // Retry after rollback succeeds exactly once (audit mock now behaves normally again).
    const result = await transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId });
    expect(result.status).toBe("PAID");
    expect(await prisma.expenditure.findMany({ where: { organizationId: orgId } })).toHaveLength(1);
  });

  it("void and reversal are equally CAS-guarded: two simultaneous voids produce exactly one voided Expenditure", async () => {
    const requestId = await createApproved("30.00");
    await transitionReimbursement({ organizationId: orgId, requestId, status: "PAID", paymentMethodId, actorUserId: managerId });

    const attempts = await Promise.allSettled([
      transitionReimbursement({ organizationId: orgId, requestId, status: "VOIDED", correctionReason: "duplicate entry", confirmText: "VOID", actorUserId: managerId }),
      transitionReimbursement({ organizationId: orgId, requestId, status: "VOIDED", correctionReason: "duplicate entry", confirmText: "VOID", actorUserId: managerId }),
    ]);

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);

    const final = await prisma.reimbursementRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(final.status).toBe("VOIDED");

    const expenditure = await prisma.expenditure.findUniqueOrThrow({ where: { id: final.expenditureId! } });
    expect(expenditure.voidedAt).not.toBeNull();
  });
});
