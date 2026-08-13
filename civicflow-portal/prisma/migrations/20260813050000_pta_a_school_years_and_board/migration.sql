-- CreateEnum
CREATE TYPE "PtaBoardClassification" AS ENUM ('OFFICER', 'BOARD_MEMBER');

-- CreateEnum
CREATE TYPE "PtaOfficerAssignmentStatus" AS ENUM ('INCOMING', 'ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "PtaHousehold" ADD COLUMN     "schoolYearId" TEXT;

-- AlterTable
ALTER TABLE "PtaClassroom" ADD COLUMN     "schoolYearId" TEXT;

-- AlterTable
ALTER TABLE "PtaStudentEnrollment" ADD COLUMN     "schoolYearId" TEXT;

-- AlterTable
ALTER TABLE "PtaVolunteerOpportunity" ADD COLUMN     "schoolYearId" TEXT;

-- CreateTable
CREATE TABLE "PtaSchoolYear" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaSchoolYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaBoardPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "responsibilities" TEXT,
    "classification" "PtaBoardClassification" NOT NULL DEFAULT 'OFFICER',
    "isVoting" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "termLengthMonths" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaBoardPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PtaOfficerAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "schoolYearId" TEXT,
    "schoolYearLabel" TEXT,
    "householdAdultId" TEXT,
    "personName" TEXT,
    "status" "PtaOfficerAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PtaOfficerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PtaSchoolYear_organizationId_idx" ON "PtaSchoolYear"("organizationId");

-- CreateIndex
CREATE INDEX "PtaSchoolYear_organizationId_isCurrent_idx" ON "PtaSchoolYear"("organizationId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "PtaSchoolYear_organizationId_label_key" ON "PtaSchoolYear"("organizationId", "label");

-- CreateIndex
CREATE INDEX "PtaBoardPosition_organizationId_idx" ON "PtaBoardPosition"("organizationId");

-- CreateIndex
CREATE INDEX "PtaBoardPosition_organizationId_isActive_idx" ON "PtaBoardPosition"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PtaBoardPosition_organizationId_name_key" ON "PtaBoardPosition"("organizationId", "name");

-- CreateIndex
CREATE INDEX "PtaOfficerAssignment_organizationId_idx" ON "PtaOfficerAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "PtaOfficerAssignment_positionId_idx" ON "PtaOfficerAssignment"("positionId");

-- CreateIndex
CREATE INDEX "PtaOfficerAssignment_organizationId_status_idx" ON "PtaOfficerAssignment"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PtaOfficerAssignment_schoolYearId_idx" ON "PtaOfficerAssignment"("schoolYearId");

-- CreateIndex
CREATE INDEX "PtaOfficerAssignment_householdAdultId_idx" ON "PtaOfficerAssignment"("householdAdultId");

-- CreateIndex
CREATE INDEX "PtaHousehold_schoolYearId_idx" ON "PtaHousehold"("schoolYearId");

-- CreateIndex
CREATE INDEX "PtaClassroom_schoolYearId_idx" ON "PtaClassroom"("schoolYearId");

-- CreateIndex
CREATE INDEX "PtaStudentEnrollment_schoolYearId_idx" ON "PtaStudentEnrollment"("schoolYearId");

-- CreateIndex
CREATE INDEX "PtaVolunteerOpportunity_schoolYearId_idx" ON "PtaVolunteerOpportunity"("schoolYearId");

-- AddForeignKey
ALTER TABLE "PtaHousehold" ADD CONSTRAINT "PtaHousehold_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaClassroom" ADD CONSTRAINT "PtaClassroom_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaStudentEnrollment" ADD CONSTRAINT "PtaStudentEnrollment_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaVolunteerOpportunity" ADD CONSTRAINT "PtaVolunteerOpportunity_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaSchoolYear" ADD CONSTRAINT "PtaSchoolYear_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaBoardPosition" ADD CONSTRAINT "PtaBoardPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerAssignment" ADD CONSTRAINT "PtaOfficerAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerAssignment" ADD CONSTRAINT "PtaOfficerAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "PtaBoardPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerAssignment" ADD CONSTRAINT "PtaOfficerAssignment_schoolYearId_fkey" FOREIGN KEY ("schoolYearId") REFERENCES "PtaSchoolYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerAssignment" ADD CONSTRAINT "PtaOfficerAssignment_householdAdultId_fkey" FOREIGN KEY ("householdAdultId") REFERENCES "PtaHouseholdAdult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PtaOfficerAssignment" ADD CONSTRAINT "PtaOfficerAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── PTA-A backfill (idempotent, additive-only — see docs/pta-vertical-2.md) ──
-- 1. Materialize one PtaSchoolYear row per distinct historical label per org,
--    from the union of every place the free-text label was ever written.
--    Ids are deterministic (md5 of org+label) so a re-run inserts nothing new.
INSERT INTO "PtaSchoolYear" ("id", "organizationId", "label", "isCurrent", "createdAt", "updatedAt")
SELECT DISTINCT
  'ptasy_' || substr(md5(src."organizationId" || ':' || src."label"), 1, 24),
  src."organizationId",
  src."label",
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT "organizationId", btrim("currentSchoolYear") AS "label" FROM "PtaProfile" WHERE btrim(coalesce("currentSchoolYear", '')) <> ''
  UNION
  SELECT "organizationId", btrim("schoolYear") FROM "PtaHousehold" WHERE btrim(coalesce("schoolYear", '')) <> ''
  UNION
  SELECT "organizationId", btrim("schoolYear") FROM "PtaClassroom" WHERE btrim(coalesce("schoolYear", '')) <> ''
  UNION
  SELECT "organizationId", btrim("schoolYear") FROM "PtaStudentEnrollment" WHERE btrim(coalesce("schoolYear", '')) <> ''
  UNION
  SELECT "organizationId", btrim("schoolYear") FROM "PtaVolunteerOpportunity" WHERE btrim(coalesce("schoolYear", '')) <> ''
) src
ON CONFLICT ("organizationId", "label") DO NOTHING;

-- 2. Mark each PTA org's current year from its PtaProfile label.
UPDATE "PtaSchoolYear" sy
SET "isCurrent" = true, "updatedAt" = CURRENT_TIMESTAMP
FROM "PtaProfile" p
WHERE sy."organizationId" = p."organizationId"
  AND sy."label" = btrim(p."currentSchoolYear")
  AND sy."isCurrent" = false;

-- 3. Backfill the four new FK columns by (org, label) join — only where NULL,
--    so a re-run (or rows created between deploy steps) are never clobbered.
UPDATE "PtaHousehold" t SET "schoolYearId" = sy."id"
FROM "PtaSchoolYear" sy
WHERE t."schoolYearId" IS NULL AND sy."organizationId" = t."organizationId" AND sy."label" = btrim(t."schoolYear");

UPDATE "PtaClassroom" t SET "schoolYearId" = sy."id"
FROM "PtaSchoolYear" sy
WHERE t."schoolYearId" IS NULL AND sy."organizationId" = t."organizationId" AND sy."label" = btrim(t."schoolYear");

UPDATE "PtaStudentEnrollment" t SET "schoolYearId" = sy."id"
FROM "PtaSchoolYear" sy
WHERE t."schoolYearId" IS NULL AND sy."organizationId" = t."organizationId" AND sy."label" = btrim(t."schoolYear");

UPDATE "PtaVolunteerOpportunity" t SET "schoolYearId" = sy."id"
FROM "PtaSchoolYear" sy
WHERE t."schoolYearId" IS NULL AND t."schoolYear" IS NOT NULL AND sy."organizationId" = t."organizationId" AND sy."label" = btrim(t."schoolYear");
