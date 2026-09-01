-- feature/pta-treasurer-expenditure-experience (E3) -- additive migration
-- adding PTA committee attribution to the Expenditure ledger.
--
-- Two new nullable columns on Expenditure:
--   1. committeeId             -- live FK to PtaCommittee, used for
--      relational filtering (e.g. "show expenditures for the Fundraising
--      committee"). Non-PTA organizations never populate this column; the
--      column itself is vertical-agnostic and inert when unused.
--   2. committeeNameAtPosting  -- an immutable snapshot of the committee's
--      display name, taken once at the moment the Expenditure is created
--      (either a direct entry or a reimbursement mark-paid) and never
--      re-derived afterward. This is what makes a later committee rename,
--      archive, or deletion harmless to historical reporting -- the
--      snapshot, not the live FK, is the source of truth for what a past
--      financial record is understood to say.
--
-- No existing row's data changes -- both columns default to NULL, so every
-- historical Expenditure row (direct or reimbursement-generated, PTA or any
-- other vertical) remains exactly as it was.
--
-- Same NOT VALID + VALIDATE CONSTRAINT split established in migration
-- 20260831140000_pta_treasurer_financial_controls: the FK is added as
-- NOT VALID (fast, no scan) then validated as its own explicit statement
-- (SHARE UPDATE EXCLUSIVE, not the full ADD CONSTRAINT lock). Because
-- committeeId is a brand-new column added in this same migration, no
-- pre-existing row can hold a non-null value yet, so validation cannot find
-- a violation -- it is still executed as a real statement rather than
-- assumed.
--
-- ON DELETE SET NULL, not RESTRICT: committeeNameAtPosting already
-- preserves the historical record's meaning independent of whether the live
-- PtaCommittee row survives, so there is no accounting reason to block a
-- committee from being archived/removed just because it once posted an
-- expense. This mirrors every other optional attribution FK already on this
-- table (category/paymentMethod/campaign/event), all SET NULL. Expenditure
-- itself is never cascade-deleted by a committee change under either
-- option -- only SET NULL and RESTRICT were considered, and SET NULL was
-- chosen for the reason above.
--
-- Migration-lock analysis (no production database was queried to produce
-- this analysis -- see docs/pta-treasurer-financial-controls.md):
--   - ADD COLUMN (both columns, nullable, no default): metadata-only in
--     PostgreSQL 11+, independent of table size.
--   - CREATE INDEX on committeeId: cannot use CONCURRENTLY inside Prisma's
--     single-transaction migration, so this is an ordinary CREATE INDEX,
--     which holds a SHARE lock (blocks writes, not reads) for the duration
--     of the index build -- a scan of the full table regardless of the new
--     column being all-NULL. This is the same category of risk already
--     accepted for the two ordinary indexes added in migration
--     20260831140000 (ReimbursementRequest.paymentMethodId/
--     correctedByUserId); production Expenditure row count is unknown, and
--     this migration does not assume it is small.
--   - ADD CONSTRAINT ... NOT VALID: near-instant, no scan.
--   - VALIDATE CONSTRAINT: a real scan, SHARE UPDATE EXCLUSIVE lock
--     (permits concurrent reads/writes, blocks only other DDL); trivially
--     fast here since every row's committeeId is NULL, but still executed
--     as a genuine statement rather than assumed.

-- ── AlterTable ───────────────────────────────────────────────────────────

ALTER TABLE "Expenditure"
  ADD COLUMN "committeeId" TEXT,
  ADD COLUMN "committeeNameAtPosting" TEXT;

-- ── CreateIndex ──────────────────────────────────────────────────────────

CREATE INDEX "Expenditure_committeeId_idx" ON "Expenditure"("committeeId");

-- ── AddForeignKey (NOT VALID -- validated explicitly below) ────────────

ALTER TABLE "Expenditure" ADD CONSTRAINT "Expenditure_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "PtaCommittee"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ── ValidateConstraint ───────────────────────────────────────────────────

ALTER TABLE "Expenditure" VALIDATE CONSTRAINT "Expenditure_committeeId_fkey";
