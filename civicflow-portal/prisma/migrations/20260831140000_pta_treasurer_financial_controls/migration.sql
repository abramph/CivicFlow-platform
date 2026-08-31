-- fix/pta-treasurer-financial-controls -- additive migration supporting the
-- PTA Treasurer financial-control correction program (read-only
-- investigation report, docs/pta-treasurer-financial-controls.md). Neither
-- of the two Family Agreement migrations, nor any earlier migration, is
-- rewritten. Every change below is additive or schema-only:
--   1. Two new terminal ReimbursementStatus values -- VOIDED (marked paid in
--      Unestra by mistake, no external payment ever happened) and REVERSED
--      (a real external payment was later cancelled/returned/recovered
--      outside Unestra). Existing SUBMITTED/UNDER_REVIEW/APPROVED/PAID/
--      REJECTED rows are completely unaffected.
--   2. A new ReimbursementCorrectionType enum (VOID | REVERSAL) recording
--      which of the two a correction was.
--   3. Five new nullable columns on ReimbursementRequest: paymentMethodId
--      (structured external-payment method, §8 of the program), and
--      correctionType/correctedAt/correctedByUserId/correctionReason (§5).
--      No existing row's data changes -- new columns default to NULL, so
--      every historical row (including PAID rows from before this
--      migration, which only ever recorded a free-text paymentReference)
--      remains exactly as it was and remains fully readable.
--   4. A CHECK constraint guaranteeing a PAID reimbursement always has its
--      Expenditure link set. lib/reimbursements.ts's CAS-guarded
--      transaction already makes this true in practice (the Expenditure
--      create and the status flip to PAID commit together or not at all);
--      this makes it a database-level fact instead of only an
--      application-level one, mirroring the discipline already used for
--      the family-agreement signer-snapshot constraint
--      (20260831130000_pta_family_agreement_signer_name_required).

-- ── 1. New terminal statuses ────────────────────────────────────────────
-- Each ADD VALUE is its own statement (a Postgres requirement); neither new
-- value is referenced anywhere else in this file, so both are safe inside
-- this migration's implicit transaction.

ALTER TYPE "ReimbursementStatus" ADD VALUE 'VOIDED';
ALTER TYPE "ReimbursementStatus" ADD VALUE 'REVERSED';

-- ── 2. Correction-type enum ─────────────────────────────────────────────

CREATE TYPE "ReimbursementCorrectionType" AS ENUM ('VOID', 'REVERSAL');

-- ── 3. New nullable columns on ReimbursementRequest ─────────────────────

ALTER TABLE "ReimbursementRequest"
  ADD COLUMN "paymentMethodId" TEXT,
  ADD COLUMN "correctionType" "ReimbursementCorrectionType",
  ADD COLUMN "correctedAt" TIMESTAMP(3),
  ADD COLUMN "correctedByUserId" TEXT,
  ADD COLUMN "correctionReason" TEXT;

-- ── CreateIndex ──────────────────────────────────────────────────────────

CREATE INDEX "ReimbursementRequest_paymentMethodId_idx" ON "ReimbursementRequest"("paymentMethodId");
CREATE INDEX "ReimbursementRequest_correctedByUserId_idx" ON "ReimbursementRequest"("correctedByUserId");

-- ── AddForeignKey ────────────────────────────────────────────────────────

ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethodConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReimbursementRequest" ADD CONSTRAINT "ReimbursementRequest_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Verify no existing PAID row is missing its Expenditure link ─────
-- Expected to be a no-op in every environment (the pre-existing code path
-- always set expenditureId and status="PAID" together), but abort loudly
-- rather than let a bare ADD CONSTRAINT fail with a less specific error if
-- one somehow exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ReimbursementRequest" WHERE "status" = 'PAID' AND "expenditureId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Migration aborted: one or more PAID ReimbursementRequest rows have no linked expenditureId. Investigate and repair the affected row(s) manually, then re-run this migration.';
  END IF;
END $$;

ALTER TABLE "ReimbursementRequest"
  ADD CONSTRAINT "ReimbursementRequest_paid_requires_expenditure_check"
  CHECK ("status" != 'PAID' OR "expenditureId" IS NOT NULL);
