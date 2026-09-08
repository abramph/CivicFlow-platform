-- PTA student-progression publication (disclosure-to-families) control.
--
-- Fully additive and backward-compatible:
--   * The new enum type is created before any column references it.
--   * Every new column is either nullable or has a constant DEFAULT, so
--     Postgres 11+ applies them as metadata-only operations (no table
--     rewrite) and no existing row is modified.
--   * publicationStatus defaults to 'UNPUBLISHED', so every pre-existing
--     committed batch stays private until explicitly published -- the
--     safe direction.
--   * Nothing is dropped, renamed, or narrowed; old application code that
--     never selects these columns keeps working unchanged.

CREATE TYPE "PtaProgressionPublicationStatus" AS ENUM ('UNPUBLISHED', 'PUBLISHED', 'WITHDRAWN');

ALTER TABLE "PtaStudentProgressionBatch"
  ADD COLUMN "publicationStatus" "PtaProgressionPublicationStatus" NOT NULL DEFAULT 'UNPUBLISHED',
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publishedByUserId" TEXT,
  ADD COLUMN "unpublishedAt" TIMESTAMP(3),
  ADD COLUMN "unpublishedByUserId" TEXT,
  ADD COLUMN "publicationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publishIdempotencyKey" TEXT;

-- Prevents a retried publish request from being recorded as a second,
-- independent disclosure event (mirrors commitIdempotencyKey).
CREATE UNIQUE INDEX "PtaStudentProgressionBatch_publishIdempotencyKey_key"
  ON "PtaStudentProgressionBatch"("publishIdempotencyKey");

-- Target-year publication lookups, organization-scoped.
CREATE INDEX "PtaStudentProgressionBatch_organizationId_toSchoolYearId_pub_idx"
  ON "PtaStudentProgressionBatch"("organizationId", "toSchoolYearId", "publicationStatus");
