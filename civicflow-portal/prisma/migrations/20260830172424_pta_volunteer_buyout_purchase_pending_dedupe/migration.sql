-- fix/pta-volunteer-financial-controls, RV-2: the application-level
-- "supersede any other PENDING purchase before creating a new one"
-- (src/lib/labs/pta/volunteer-hours/purchases.ts) is a check-then-act
-- sequence, not a real concurrency guarantee — two simultaneous checkout
-- preparations for the same household+period can both observe "no PENDING
-- purchase exists," both supersede nothing, and both insert a PENDING row,
-- each proceeding toward its own Stripe Checkout Session. This index makes
-- that impossible at the database level: a real unique-constraint
-- violation on the SECOND concurrent insert, not a race window.
--
-- "Active" here means PENDING only, deliberately narrower than the
-- assessment-charge index (FC-8/RV-10), which also blocks PAID. A
-- COMPLETED buyout purchase must NOT block a later purchase for the same
-- household+period — a family legitimately buying 5 hours now and 5 more
-- hours next month creates two independent COMPLETED purchase rows, and
-- FC-5's own remaining-hours cap (not this index) is what already prevents
-- buying more than is actually still owed. FAILED and REFUNDED are also
-- excluded so a superseded/expired/refunded purchase never blocks a
-- legitimate retry or a fresh purchase — no history is ever deleted or
-- overwritten to make a retry succeed; a new row is always created.
--
-- Hand-authored (not `prisma migrate diff`-generated) for the same reason
-- as PtaVolunteerAssessmentCharge's index (see that model's schema-drift
-- warning in schema.prisma, and PropertyResident's original precedent):
-- Prisma's schema DSL has no partial/filtered-unique-index syntax.
CREATE UNIQUE INDEX "PtaVolunteerBuyoutPurchase_org_period_household_pending"
  ON "PtaVolunteerBuyoutPurchase"("organizationId", "requirementPeriodId", "householdId")
  WHERE "status" = 'PENDING';
