-- PTA progression: allow a new attempt after a rollback.
--
-- The foundation migration created an UNCONDITIONAL unique index on
-- (organizationId, fromSchoolYearId, toSchoolYearId). That made rollback a
-- dead end: the rolled-back batch kept occupying the year pair forever, so a
-- school that used the product's own undo could never run that transition
-- again. The API returned PTA_PROGRESSION_BATCH_ALREADY_EXISTS and advised
-- "roll it back" -- the very action already taken.
--
-- Replace it with a PARTIAL unique index that ignores rolled-back rows, so:
--   * at most ONE non-rolled-back batch exists per transition (unchanged
--     guarantee, still enforced by the database, not by application code);
--   * any number of ROLLED_BACK attempts may coexist as immutable history.
--
-- Safety of the publication model: a batch reaches ROLLED_BACK only from
-- COMMITTED or CORRECTED, and rollbackProgressionBatch refuses to roll back a
-- PUBLISHED batch (assertNotPublishedForRollback). A ROLLED_BACK row is
-- therefore never PUBLISHED, so at most one batch per transition can ever be
-- PUBLISHED and two batches still cannot disagree about whether the same
-- transition is disclosed.
--
-- Data safety: the new index is strictly WEAKER than the one it replaces --
-- every dataset that satisfied the old constraint satisfies this one. No row
-- is read, rewritten, or deleted by this migration.

-- 1. Drop the unconditional unique index (Prisma truncated the generated name
--    to 63 characters, hence the doubled underscore before "_key").
DROP INDEX IF EXISTS "PtaStudentProgressionBatch_organizationId_fromSchoolYearId__key";

-- 2. One ACTIVE (non-rolled-back) batch per transition.
CREATE UNIQUE INDEX "PtaStudentProgressionBatch_active_transition_key"
  ON "PtaStudentProgressionBatch" ("organizationId", "fromSchoolYearId", "toSchoolYearId")
  WHERE "status" <> 'ROLLED_BACK';

-- 3. The dropped unique index also served year-pair lookups; keep a plain
--    (non-unique) index so history queries for a transition stay indexed.
CREATE INDEX "PtaStudentProgressionBatch_organizationId_fromSchoolYearId__idx"
  ON "PtaStudentProgressionBatch" ("organizationId", "fromSchoolYearId", "toSchoolYearId");
