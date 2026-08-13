-- CreateEnum
CREATE TYPE "PtaCommitteeStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "PtaCommittee" ADD COLUMN     "boardLiaisonAdultId" TEXT,
ADD COLUMN     "goals" TEXT,
ADD COLUMN     "meetingSchedule" TEXT,
ADD COLUMN     "schoolYear" TEXT,
ADD COLUMN     "schoolYearId" TEXT,
ADD COLUMN     "status" "PtaCommitteeStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "PtaCommittee_organizationId_status_idx" ON "PtaCommittee"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaCommittee_schoolYearId_idx" ON "PtaCommittee"("schoolYearId");

-- AddForeignKey
ALTER TABLE "PtaCommittee" ADD CONSTRAINT "PtaCommittee_boardLiaisonAdultId_fkey" FOREIGN KEY ("boardLiaisonAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaCommittee" ADD CONSTRAINT "PtaCommittee_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── PTA-B backfill (idempotent, additive-only — see docs/pta-vertical-2.md) ──
-- Existing committees get the org's current school year (same convention the
-- volunteer-opportunity fix used): label from PtaProfile, FK by label join.
-- Only rows still NULL are touched, so re-runs and future writes are safe.
UPDATE "PtaCommittee" c
SET "schoolYear" = btrim(p."currentSchoolYear")
FROM "PtaProfile" p
WHERE c."schoolYear" IS NULL
  AND p."organizationId" = c."organizationId"
  AND btrim(coalesce(p."currentSchoolYear", '')) <> '';

UPDATE "PtaCommittee" c
SET "schoolYearId" = sy."id"
FROM "PtaSchoolYear" sy
WHERE c."schoolYearId" IS NULL
  AND c."schoolYear" IS NOT NULL
  AND sy."organizationId" = c."organizationId"
  AND sy."label" = btrim(c."schoolYear");
