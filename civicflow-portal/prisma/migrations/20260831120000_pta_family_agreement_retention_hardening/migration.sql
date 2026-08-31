-- feature/pta-family-agreement-buyout follow-up (FA3 §3). A new, additive
-- migration -- the original family-agreement migration
-- (20260830190000_pta_family_agreement_contract_linked_buyout) is left
-- untouched, per instruction.
--
-- Purpose: agreement acceptances, buyout elections, buyout purchases,
-- assessment charges, and hour disputes are historical/financial/
-- compliance records. Their household/period foreign keys were originally
-- ON DELETE CASCADE (matching the rest of this program's convention for
-- ordinary, non-historical child rows), which means a household or period
-- hard-delete would silently destroy that history. This migration swaps
-- those 11 foreign keys to ON DELETE RESTRICT and adds a permanent signer
-- display-name snapshot to the acceptance table so historical display
-- never depends on a live join to a household adult or user record that
-- may later be removed.
--
-- Confirmed via read-only production row counts before writing this
-- migration (FA3 §1): PtaVolunteerBuyoutElection, PtaVolunteerBuyoutPurchase,
-- PtaVolunteerAssessmentCharge, and PtaVolunteerHourDispute all have ZERO
-- rows in production. PtaVolunteerAgreementVersion/Acceptance do not exist
-- in production at all (that migration is not yet deployed). No existing
-- row anywhere is affected by this migration -- every change here is a
-- pure future-behavior change (what happens on a delete attempt that has
-- never occurred and, per application code, is never attempted), not a
-- data migration.
--
-- Why RESTRICT (not a soft check) is sufficient on its own: Postgres
-- aborts an ENTIRE delete statement if ANY single foreign key with
-- ON DELETE RESTRICT would be violated, regardless of what other
-- Cascade/SetNull relationships also reference the same row. Restricting
-- PtaVolunteerAgreementAcceptance.requirementPeriodId (and the other 4
-- models' own period FKs) is therefore already sufficient, on its own, to
-- block a period hard-delete whenever any of this history exists for it --
-- independent of PtaVolunteerAgreementVersion's own (also now Restrict,
-- for defense in depth) relationship to the period, and independent of
-- PtaVolunteerAssessmentBatch/Line's own (deliberately untouched, out of
-- scope -- see docs) Cascade relationship to period, which no application
-- code path ever exercises by itself.

-- ── Drop the 11 unsafe (Cascade) foreign keys ──────────────────────────

-- AlterTable / DropForeignKey: PtaVolunteerAgreementAcceptance
ALTER TABLE "PtaVolunteerAgreementAcceptance" DROP CONSTRAINT "PtaVolunteerAgreementAcceptance_householdId_fkey";
ALTER TABLE "PtaVolunteerAgreementAcceptance" DROP CONSTRAINT "PtaVolunteerAgreementAcceptance_requirementPeriodId_fkey";

-- DropForeignKey: PtaVolunteerAgreementVersion
ALTER TABLE "PtaVolunteerAgreementVersion" DROP CONSTRAINT "PtaVolunteerAgreementVersion_requirementPeriodId_fkey";

-- DropForeignKey: PtaVolunteerBuyoutElection
ALTER TABLE "PtaVolunteerBuyoutElection" DROP CONSTRAINT "PtaVolunteerBuyoutElection_householdId_fkey";
ALTER TABLE "PtaVolunteerBuyoutElection" DROP CONSTRAINT "PtaVolunteerBuyoutElection_requirementPeriodId_fkey";

-- DropForeignKey: PtaVolunteerBuyoutPurchase
ALTER TABLE "PtaVolunteerBuyoutPurchase" DROP CONSTRAINT "PtaVolunteerBuyoutPurchase_householdId_fkey";
ALTER TABLE "PtaVolunteerBuyoutPurchase" DROP CONSTRAINT "PtaVolunteerBuyoutPurchase_requirementPeriodId_fkey";

-- DropForeignKey: PtaVolunteerAssessmentCharge
ALTER TABLE "PtaVolunteerAssessmentCharge" DROP CONSTRAINT "PtaVolunteerAssessmentCharge_householdId_fkey";
ALTER TABLE "PtaVolunteerAssessmentCharge" DROP CONSTRAINT "PtaVolunteerAssessmentCharge_requirementPeriodId_fkey";

-- DropForeignKey: PtaVolunteerHourDispute
ALTER TABLE "PtaVolunteerHourDispute" DROP CONSTRAINT "PtaVolunteerHourDispute_householdId_fkey";
ALTER TABLE "PtaVolunteerHourDispute" DROP CONSTRAINT "PtaVolunteerHourDispute_requirementPeriodId_fkey";

-- ── Add the signer display-name snapshot (nullable relationship,
-- NOT NULL name with a technical default -- no production row exists to
-- ever actually receive that default; it exists purely so this ALTER
-- TABLE is unconditionally safe regardless of row count) ─────────────────

-- AlterTable: PtaVolunteerAgreementAcceptance
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD COLUMN     "signerDisplayNameAtAcceptance" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "signerRelationshipAtAcceptance" TEXT;

-- ── Recreate the same 11 foreign keys as RESTRICT ──────────────────────

-- AddForeignKey: PtaVolunteerAgreementVersion
ALTER TABLE "PtaVolunteerAgreementVersion" ADD CONSTRAINT "PtaVolunteerAgreementVersion_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: PtaVolunteerAgreementAcceptance
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PtaVolunteerAgreementAcceptance" ADD CONSTRAINT "PtaVolunteerAgreementAcceptance_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: PtaVolunteerBuyoutElection
ALTER TABLE "PtaVolunteerBuyoutElection" ADD CONSTRAINT "PtaVolunteerBuyoutElection_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PtaVolunteerBuyoutElection" ADD CONSTRAINT "PtaVolunteerBuyoutElection_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: PtaVolunteerBuyoutPurchase
ALTER TABLE "PtaVolunteerBuyoutPurchase" ADD CONSTRAINT "PtaVolunteerBuyoutPurchase_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PtaVolunteerBuyoutPurchase" ADD CONSTRAINT "PtaVolunteerBuyoutPurchase_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: PtaVolunteerAssessmentCharge
ALTER TABLE "PtaVolunteerAssessmentCharge" ADD CONSTRAINT "PtaVolunteerAssessmentCharge_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PtaVolunteerAssessmentCharge" ADD CONSTRAINT "PtaVolunteerAssessmentCharge_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: PtaVolunteerHourDispute
ALTER TABLE "PtaVolunteerHourDispute" ADD CONSTRAINT "PtaVolunteerHourDispute_requirementPeriodId_fkey" FOREIGN KEY ("requirementPeriodId") REFERENCES "PtaVolunteerRequirementPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PtaVolunteerHourDispute" ADD CONSTRAINT "PtaVolunteerHourDispute_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "PtaHousehold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
