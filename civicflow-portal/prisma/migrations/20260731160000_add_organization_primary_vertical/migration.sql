-- CreateEnum
CREATE TYPE "OrganizationVertical" AS ENUM ('COMMUNITY', 'PTA', 'UNION', 'HOA');

-- AlterTable: default COMMUNITY makes this additive and NOT NULL from the
-- start — no nullable-then-backfill-then-set-NOT-NULL dance needed, since
-- COMMUNITY is the safe default for every organization until reclassified
-- below or by explicit Platform Admin / signup selection going forward.
ALTER TABLE "Organization" ADD COLUMN     "primaryVertical" "OrganizationVertical" NOT NULL DEFAULT 'COMMUNITY';

-- Backfill: reclassify as PTA only where there is reliable evidence — active
-- PTA Labs enrollment, or an existing PtaProfile row (a customer only gets a
-- PtaProfile through the PTA setup flow, itself gated behind ptaVertical
-- Labs enrollment). Deliberately evidence-based, never inferred from
-- organizationType or organization name. No UNION or HOA organizations exist
-- as of this migration, so nothing is (or ever will be, by this migration)
-- auto-classified into either — that requires explicit Platform Admin or
-- owner selection, by design.
UPDATE "Organization"
SET "primaryVertical" = 'PTA'
WHERE id IN (
  SELECT "organizationId" FROM "OrganizationLabFeature" WHERE "featureKey" = 'ptaVertical' AND status = 'ENABLED'
  UNION
  SELECT "organizationId" FROM "PtaProfile"
);
