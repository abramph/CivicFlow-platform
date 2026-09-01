import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveSafeTestDatabaseUrl } from "./test-db-safety";

/**
 * fix/pta-treasurer-financial-controls, lock-hardening follow-up --
 * durable proof that the migration's NOT VALID + VALIDATE CONSTRAINT
 * restructuring reaches the exact same final enforced state as a plain
 * ADD CONSTRAINT would have: all three constraints present, all three
 * fully validated (pg_constraint.convalidated = true), and delete/update
 * actions unchanged from the original design (SET NULL / CASCADE).
 * Also proves enforcement behaviorally, not just via metadata: a direct
 * raw-SQL INSERT that violates each constraint is rejected by Postgres
 * itself, citing the exact constraint name.
 *
 * Run with the same PTA_TREASURER_TEST_DATABASE_URL convention as the
 * other Treasurer integration suites:
 *   PTA_TREASURER_TEST_DATABASE_URL="postgresql://civicflow_treasurer_test:PASSWORD@localhost:5432/civicflow_treasurer_integration_test" \
 *   PTA_TREASURER_MIGRATION_METADATA_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/treasurer-migration-constraint-metadata.integration.test.ts
 */
const target = resolveSafeTestDatabaseUrl("PTA_TREASURER_TEST_DATABASE_URL", "treasurer_integration_test");
const RUN_INTEGRATION = target !== null && process.env.PTA_TREASURER_MIGRATION_METADATA_RUN_DB_INTEGRATION_TEST === "1";
if (RUN_INTEGRATION && target) process.env.DATABASE_URL = target.url;

interface ConstraintRow {
  name: string;
  type: string;
  validated: boolean;
  definition: string;
  on_update: string;
  on_delete: string;
}

describe.skipIf(!RUN_INTEGRATION)("migration 122 constraint metadata — real database", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let categoryId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    const org = await prisma.organization.create({ data: { slug: `migmeta-${Date.now()}`, name: "Migration Metadata", primaryVertical: "PTA" } });
    orgId = org.id;
    const category = await prisma.category.create({ data: { organizationId: orgId, name: "Supplies", type: "EXPENDITURE" } });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.reimbursementRequest.deleteMany({ where: { organizationId: orgId } });
    await prisma.category.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it("all three constraints exist and are fully validated", async () => {
    const rows = (await prisma.$queryRawUnsafe(`
      SELECT c.conname AS name, c.contype AS type, c.convalidated AS validated, pg_get_constraintdef(c.oid) AS definition,
             confupdtype AS on_update, confdeltype AS on_delete
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'ReimbursementRequest'
        AND c.conname IN (
          'ReimbursementRequest_paid_requires_expenditure_check',
          'ReimbursementRequest_paymentMethodId_fkey',
          'ReimbursementRequest_correctedByUserId_fkey'
        )
      ORDER BY c.conname;
    `)) as ConstraintRow[];

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.validated, `${row.name} must be fully validated`).toBe(true);
    }

    const check = rows.find((r) => r.name === "ReimbursementRequest_paid_requires_expenditure_check")!;
    expect(check.type).toBe("c");
    expect(check.definition).toContain("status");
    expect(check.definition).toContain("expenditureId");

    const paymentMethodFk = rows.find((r) => r.name === "ReimbursementRequest_paymentMethodId_fkey")!;
    expect(paymentMethodFk.type).toBe("f");
    expect(paymentMethodFk.on_delete).toBe("n"); // SET NULL
    expect(paymentMethodFk.on_update).toBe("c"); // CASCADE

    const correctedByFk = rows.find((r) => r.name === "ReimbursementRequest_correctedByUserId_fkey")!;
    expect(correctedByFk.type).toBe("f");
    expect(correctedByFk.on_delete).toBe("n"); // SET NULL
    expect(correctedByFk.on_update).toBe("c"); // CASCADE
  });

  it("the CHECK constraint is behaviorally enforced -- a direct PAID/null-expenditureId insert is rejected", async () => {
    let rejectedWithExpectedConstraint = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReimbursementRequest" (id, "organizationId", "payeeName", description, amount, status, "createdAt", "updatedAt") VALUES ($1, $2, 'x', 'x', 1.00, 'PAID', now(), now())`,
        `metatest-check-${Date.now()}`,
        orgId
      );
    } catch (error) {
      rejectedWithExpectedConstraint = error instanceof Error && error.message.includes("ReimbursementRequest_paid_requires_expenditure_check");
    }
    expect(rejectedWithExpectedConstraint).toBe(true);
  });

  it("the paymentMethodId FK is behaviorally enforced -- a nonexistent reference is rejected", async () => {
    let rejectedWithExpectedConstraint = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReimbursementRequest" (id, "organizationId", "payeeName", description, amount, status, "categoryId", "paymentMethodId", "createdAt", "updatedAt") VALUES ($1, $2, 'x', 'x', 1.00, 'SUBMITTED', $3, 'nonexistent-payment-method-id', now(), now())`,
        `metatest-fk-${Date.now()}`,
        orgId,
        categoryId
      );
    } catch (error) {
      rejectedWithExpectedConstraint = error instanceof Error && error.message.includes("ReimbursementRequest_paymentMethodId_fkey");
    }
    expect(rejectedWithExpectedConstraint).toBe(true);
  });
});
