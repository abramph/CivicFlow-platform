import { describe, expect, it } from "vitest";
import { resolveSafeTestDatabaseUrl } from "./test-db-safety";

/**
 * fix/pta-treasurer-financial-controls — proves, against a real disposable
 * Postgres database migrated to migration 122
 * (20260831140000_pta_treasurer_financial_controls), that the EXACT
 * statement sequence currently deployed to production at commit 966e6c8
 * still succeeds. This is not an approximation from memory: the
 * transaction body below is a byte-for-byte copy of
 * `git show 966e6c8:civicflow-portal/src/lib/reimbursements.ts`'s PAID
 * branch (lines ~155-176), including the absence of any CAS/updateMany
 * guard -- old code really did use a plain `update()` keyed only by id,
 * which is exactly why it had the D1 double-booking race this whole
 * program exists to fix. What it did NOT have is the two-statement
 * status-then-expenditureId split; this test proves that directly.
 *
 * One-time local setup: same PTA_TREASURER_TEST_DATABASE_URL as the other
 * Treasurer integration suites. Run with:
 *   PTA_TREASURER_TEST_DATABASE_URL="postgresql://civicflow_treasurer_test:PASSWORD@localhost:5432/civicflow_treasurer_integration_test" \
 *   PTA_TREASURER_LEGACY_COMPAT_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/__tests__/legacy-mark-paid-migration-compatibility.integration.test.ts
 */
const target = resolveSafeTestDatabaseUrl("PTA_TREASURER_TEST_DATABASE_URL", "treasurer_integration_test");
const RUN_INTEGRATION = target !== null && process.env.PTA_TREASURER_LEGACY_COMPAT_RUN_DB_INTEGRATION_TEST === "1";
if (RUN_INTEGRATION && target) process.env.DATABASE_URL = target.url;

describe.skipIf(!RUN_INTEGRATION)("legacy (966e6c8) mark-paid statement sequence — real database, post-migration-122", () => {
  it("the exact currently-deployed statement sequence succeeds against the new schema, satisfies the CHECK constraint, and books exactly one Expenditure", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();

    const org = await prisma.organization.create({ data: { slug: `legacy-compat-${Date.now()}`, name: "Legacy Compat", primaryVertical: "PTA" } });
    const submitter = await prisma.user.create({ data: { email: `legacy-compat-${Date.now()}@example.test`, passwordHash: "x" } });
    const category = await prisma.category.create({ data: { organizationId: org.id, name: "Supplies", type: "EXPENDITURE" } });
    const existing = await prisma.reimbursementRequest.create({
      data: { organizationId: org.id, submittedByUserId: submitter.id, payeeName: "Legacy Payee", description: "Legacy spend", amount: "42.50", categoryId: category.id, status: "APPROVED" },
    });

    const now = new Date();
    const actorUserId = submitter.id;
    const input = { organizationId: org.id, paymentReference: null as string | null, reviewNotes: undefined as string | undefined };

    // ── Verbatim copy of 966e6c8's PAID transaction body ──────────────
    // (git show 966e6c8:civicflow-portal/src/lib/reimbursements.ts, PAID branch)
    let thrown: unknown = null;
    let request: { id: string; status: string; expenditureId: string | null } | undefined;
    try {
      [request] = await prisma.$transaction(async (tx) => {
        const expenditure = await tx.expenditure.create({
          data: {
            organizationId: input.organizationId,
            description: `Reimbursement: ${existing.description}`,
            amount: existing.amount,
            categoryId: existing.categoryId,
            date: now,
            vendor: existing.payeeName,
            eventId: existing.eventId,
            reference: input.paymentReference?.trim() || `REIMB-${existing.id.slice(-8)}`,
            notes: "Booked automatically when the reimbursement request was marked paid.",
          },
        });
        const updated = await tx.reimbursementRequest.update({
          where: { id: existing.id },
          data: {
            status: "PAID",
            paidByUserId: actorUserId,
            paidAt: now,
            paymentReference: input.paymentReference?.trim() || null,
            expenditureId: expenditure.id,
            ...(input.reviewNotes !== undefined ? { reviewNotes: (input.reviewNotes as string | undefined)?.trim() || null } : {}),
          },
        });
        return [updated, expenditure];
      });
    } catch (error) {
      thrown = error;
    }
    // ── end verbatim copy ──────────────────────────────────────────────

    expect(thrown, `legacy statement sequence threw (expected to succeed): ${String((thrown as Error)?.message)}`).toBeNull();
    expect(request?.status).toBe("PAID");
    expect(request?.expenditureId).not.toBeNull();

    const expenditures = await prisma.expenditure.findMany({ where: { organizationId: org.id } });
    expect(expenditures).toHaveLength(1);
    expect(expenditures[0].id).toBe(request?.expenditureId);

    // Direct proof no CHECK violation occurred: the committed row itself
    // satisfies the constraint (this would be structurally impossible to
    // observe as a committed row otherwise -- Postgres would have rejected
    // the UPDATE and `thrown` above would be non-null).
    const finalRow = await prisma.reimbursementRequest.findUniqueOrThrow({ where: { id: existing.id } });
    expect(finalRow.status).toBe("PAID");
    expect(finalRow.expenditureId).not.toBeNull();

    await prisma.reimbursementRequest.deleteMany({ where: { organizationId: org.id } });
    await prisma.expenditure.deleteMany({ where: { organizationId: org.id } });
    await prisma.category.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.user.deleteMany({ where: { id: submitter.id } });
    await prisma.$disconnect();
  });
});
