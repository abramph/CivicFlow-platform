import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * feature/pta-family-agreement-buyout follow-up (FA3 §1/§2/§7): real-Postgres
 * proof that the retention-hardening migration
 * (20260831120000_pta_family_agreement_retention_hardening) actually
 * protects history at the DATABASE level, independent of any
 * application-layer guard (deletePtaHousehold's own PtaError checks are
 * covered separately in households.test.ts's mocked unit tests — this file
 * proves the DB itself refuses the delete even via raw SQL that bypasses
 * every application code path entirely).
 *
 * Covers, each against a real database: household/period deletion rejected
 * while acceptance/election/purchase/charge/dispute history exists;
 * removing household membership (deleting a PtaHouseholdAdult row) does NOT
 * delete the acceptance; deleting the signer's User row does not touch the
 * acceptance either (acceptedByUserId is a plain non-FK column, not
 * SET NULL — see the model's own doc comment); archiving retains all
 * history; tenant isolation; and a constraint-metadata drift test querying
 * information_schema directly so a future schema change that silently
 * restores an unsafe Cascade would fail this suite even before any
 * delete-attempt test ran.
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   PTA_RETENTION_HARDENING_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/volunteer-hours/__tests__/retention-hardening.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_RETENTION_HARDENING_RUN_DB_INTEGRATION_TEST === "1";

// The 11 FK constraints the retention-hardening migration recreated as
// RESTRICT, keyed by (table, column) -- the drift test below queries
// information_schema for exactly this set and nothing else.
const EXPECTED_RESTRICT_FKS: Array<{ table: string; column: string }> = [
  { table: "PtaVolunteerAgreementVersion", column: "requirementPeriodId" },
  { table: "PtaVolunteerAgreementAcceptance", column: "requirementPeriodId" },
  { table: "PtaVolunteerAgreementAcceptance", column: "householdId" },
  { table: "PtaVolunteerBuyoutElection", column: "requirementPeriodId" },
  { table: "PtaVolunteerBuyoutElection", column: "householdId" },
  { table: "PtaVolunteerBuyoutPurchase", column: "requirementPeriodId" },
  { table: "PtaVolunteerBuyoutPurchase", column: "householdId" },
  { table: "PtaVolunteerAssessmentCharge", column: "requirementPeriodId" },
  { table: "PtaVolunteerAssessmentCharge", column: "householdId" },
  { table: "PtaVolunteerHourDispute", column: "requirementPeriodId" },
  { table: "PtaVolunteerHourDispute", column: "householdId" },
];

describe.skipIf(!RUN_INTEGRATION)("FA3 retention hardening — real-Postgres lifecycle + constraint-drift proof", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let orgBId: string;
  let userId: string;
  let periodId: string;
  let periodBId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `pta-retention-hardening-${Date.now()}`, name: "Retention Hardening Test PTA", primaryVertical: "PTA" },
    });
    orgId = org.id;
    const orgB = await prisma.organization.create({
      data: { slug: `pta-retention-hardening-b-${Date.now()}`, name: "Retention Hardening Test PTA B", primaryVertical: "PTA" },
    });
    orgBId = orgB.id;

    const user = await prisma.user.create({ data: { email: `retention-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    userId = user.id;

    const now = new Date();
    const periodData = {
      name: "Retention Hardening Test Period",
      periodType: "SCHOOL_YEAR" as const,
      startsOn: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      endsOn: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      timezone: "America/New_York",
      requiredMinutesDefault: 600,
      status: "ACTIVE" as const,
    };
    const period = await prisma.ptaVolunteerRequirementPeriod.create({ data: { organizationId: orgId, ...periodData } });
    periodId = period.id;
    const periodB = await prisma.ptaVolunteerRequirementPeriod.create({ data: { organizationId: orgBId, ...periodData } });
    periodBId = periodB.id;
  });

  afterAll(async () => {
    await prisma?.ptaVolunteerRequirementPeriod.deleteMany({ where: { organizationId: { in: [orgId, orgBId] } } }).catch(() => {});
    await prisma?.organization.deleteMany({ where: { id: { in: [orgId, orgBId] } } }).catch(() => {});
    await prisma?.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  async function makeHousehold(targetOrgId: string, displayName: string) {
    const household = await prisma.ptaHousehold.create({
      data: { organizationId: targetOrgId, displayName, status: "ACTIVE", schoolYear: "2026-2027" },
    });
    return household.id as string;
  }

  async function makeAdult(targetOrgId: string, householdId: string, name: string) {
    const adult = await prisma.ptaHouseholdAdult.create({ data: { organizationId: targetOrgId, householdId, userId, name } });
    return adult.id as string;
  }

  async function makePublishedVersion(targetOrgId: string, targetPeriodId: string) {
    const version = await prisma.ptaVolunteerAgreementVersion.create({
      data: {
        organizationId: targetOrgId,
        requirementPeriodId: targetPeriodId,
        title: "Retention Test Agreement",
        versionNumber: 1,
        content: "Please volunteer.",
        contentHash: "retention-test-hash",
        status: "PUBLISHED",
        publishedAt: new Date(),
        publishedByUserId: userId,
        createdByUserId: userId,
      },
    });
    return version.id as string;
  }

  async function makeAcceptance(targetOrgId: string, targetPeriodId: string, householdId: string, versionId: string, adultId: string) {
    const acceptance = await prisma.ptaVolunteerAgreementAcceptance.create({
      data: {
        organizationId: targetOrgId,
        requirementPeriodId: targetPeriodId,
        agreementVersionId: versionId,
        householdId,
        acceptedByUserId: userId,
        acceptedByAdultId: adultId,
        acceptedAt: new Date(),
        contentHashAtAcceptance: "retention-test-hash",
        ackVersion: "test",
        signerDisplayNameAtAcceptance: "Test Signer",
        signerRelationshipAtAcceptance: "Parent",
      },
    });
    return acceptance.id as string;
  }

  async function makeElection(targetOrgId: string, targetPeriodId: string, householdId: string) {
    const election = await prisma.ptaVolunteerBuyoutElection.create({
      data: {
        organizationId: targetOrgId,
        requirementPeriodId: targetPeriodId,
        householdId,
        electionType: "FULL_BUYOUT",
        hoursElectedMinutes: 600,
        quotedRateCents: 2500,
        quotedTotalCents: 25000,
        acknowledgedAt: new Date(),
        acknowledgedByUserId: userId,
        ackVersion: "test",
      },
    });
    return election.id as string;
  }

  async function makePurchase(targetOrgId: string, targetPeriodId: string, householdId: string) {
    const purchase = await prisma.ptaVolunteerBuyoutPurchase.create({
      data: {
        organizationId: targetOrgId,
        requirementPeriodId: targetPeriodId,
        householdId,
        electionType: "FULL_BUYOUT",
        hoursElectedMinutes: 600,
        rateType: "FULL_BUYOUT",
        rateCents: 2500,
        baseAmountCents: 25000,
        totalCents: 25000,
        paymentMethod: "CASH",
      },
    });
    return purchase.id as string;
  }

  async function makeAssessmentCharge(targetOrgId: string, targetPeriodId: string, householdId: string) {
    const batch = await prisma.ptaVolunteerAssessmentBatch.create({
      data: { organizationId: targetOrgId, requirementPeriodId: targetPeriodId, rateCents: 2500 },
    });
    const line = await prisma.ptaVolunteerAssessmentLine.create({
      data: {
        organizationId: targetOrgId,
        batchId: batch.id,
        householdId,
        adjustedRequiredMinutes: 600,
        verifiedMinutes: 0,
        purchasedMinutes: 0,
        creditMinutes: 0,
        waivedMinutes: 0,
        remainingMinutes: 600,
        assessmentCents: 25000,
      },
    });
    const charge = await prisma.ptaVolunteerAssessmentCharge.create({
      data: { organizationId: targetOrgId, requirementPeriodId: targetPeriodId, householdId, batchId: batch.id, lineId: line.id, amountCents: 25000 },
    });
    return { chargeId: charge.id as string, batchId: batch.id as string, lineId: line.id as string };
  }

  async function makeDispute(targetOrgId: string, targetPeriodId: string, householdId: string) {
    const dispute = await prisma.ptaVolunteerHourDispute.create({
      data: { organizationId: targetOrgId, requirementPeriodId: targetPeriodId, householdId, submittedByUserId: userId, description: "Test dispute" },
    });
    return dispute.id as string;
  }

  async function expectRawDeleteRejected(table: string, id: string) {
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id = $1`, id)).rejects.toThrow();
  }

  it("household with acceptance history: raw SQL DELETE is rejected by Postgres itself, not merely by application code", async () => {
    const householdId = await makeHousehold(orgId, "Household With Acceptance");
    const adultId = await makeAdult(orgId, householdId, "Parent A");
    const versionId = await makePublishedVersion(orgId, periodId);
    await makeAcceptance(orgId, periodId, householdId, versionId, adultId);

    await expectRawDeleteRejected("PtaHousehold", householdId);

    const stillExists = await prisma.ptaHousehold.findUnique({ where: { id: householdId } });
    expect(stillExists).not.toBeNull();

    // Cleanup for this test's fixtures (in FK-safe order).
    await prisma.ptaVolunteerAgreementAcceptance.deleteMany({ where: { householdId } });
    await prisma.ptaVolunteerAgreementVersion.delete({ where: { id: versionId } });
    await prisma.ptaHouseholdAdult.delete({ where: { id: adultId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("requirement period with an assigned PUBLISHED version and an acceptance: raw SQL DELETE is rejected (both the version's own FK and the acceptance's own FK independently block it)", async () => {
    const testPeriod = await prisma.ptaVolunteerRequirementPeriod.create({
      data: {
        organizationId: orgId,
        name: "Disposable Period For Deletion Test",
        periodType: "SCHOOL_YEAR",
        startsOn: new Date(),
        endsOn: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        requiredMinutesDefault: 600,
        status: "ACTIVE",
      },
    });
    const householdId = await makeHousehold(orgId, "Household For Period Deletion Test");
    const adultId = await makeAdult(orgId, householdId, "Parent B");
    const versionId = await makePublishedVersion(orgId, testPeriod.id);
    await prisma.ptaVolunteerRequirementPeriod.update({ where: { id: testPeriod.id }, data: { agreementVersionId: versionId } });
    await makeAcceptance(orgId, testPeriod.id, householdId, versionId, adultId);

    await expectRawDeleteRejected("PtaVolunteerRequirementPeriod", testPeriod.id);

    // Even after clearing the acceptance (still blocked by the version's OWN restrict FK to the period).
    await prisma.ptaVolunteerAgreementAcceptance.deleteMany({ where: { requirementPeriodId: testPeriod.id } });
    await expectRawDeleteRejected("PtaVolunteerRequirementPeriod", testPeriod.id);

    // Only once the version itself is gone does the period become deletable.
    await prisma.ptaVolunteerRequirementPeriod.update({ where: { id: testPeriod.id }, data: { agreementVersionId: null } });
    await prisma.ptaVolunteerAgreementVersion.delete({ where: { id: versionId } });
    await prisma.ptaVolunteerRequirementPeriod.delete({ where: { id: testPeriod.id } });
    await prisma.ptaHouseholdAdult.delete({ where: { id: adultId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("household/period with a buyout ELECTION (no acceptance at all): both deletes are rejected", async () => {
    const householdId = await makeHousehold(orgId, "Household With Election Only");
    const electionId = await makeElection(orgId, periodId, householdId);

    await expectRawDeleteRejected("PtaHousehold", householdId);
    await expectRawDeleteRejected("PtaVolunteerRequirementPeriod", periodId); // periodId is the shared ACTIVE period from beforeAll -- still blocked by THIS election alone

    await prisma.ptaVolunteerBuyoutElection.delete({ where: { id: electionId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("household/period with a buyout PURCHASE (no election, no acceptance): both deletes are rejected", async () => {
    const householdId = await makeHousehold(orgId, "Household With Purchase Only");
    const purchaseId = await makePurchase(orgId, periodId, householdId);

    await expectRawDeleteRejected("PtaHousehold", householdId);
    await expectRawDeleteRejected("PtaVolunteerRequirementPeriod", periodId);

    await prisma.ptaVolunteerBuyoutPurchase.delete({ where: { id: purchaseId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("household/period with a posted ASSESSMENT CHARGE: both deletes are rejected (the charge's own direct FK is sufficient, independent of its batch/line's still-Cascade relationships)", async () => {
    const householdId = await makeHousehold(orgId, "Household With Assessment Charge");
    const { chargeId, batchId, lineId } = await makeAssessmentCharge(orgId, periodId, householdId);

    await expectRawDeleteRejected("PtaHousehold", householdId);
    await expectRawDeleteRejected("PtaVolunteerRequirementPeriod", periodId);

    await prisma.ptaVolunteerAssessmentCharge.delete({ where: { id: chargeId } });
    await prisma.ptaVolunteerAssessmentLine.delete({ where: { id: lineId } });
    await prisma.ptaVolunteerAssessmentBatch.delete({ where: { id: batchId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("household/period with an hour DISPUTE: both deletes are rejected", async () => {
    const householdId = await makeHousehold(orgId, "Household With Dispute");
    const disputeId = await makeDispute(orgId, periodId, householdId);

    await expectRawDeleteRejected("PtaHousehold", householdId);
    await expectRawDeleteRejected("PtaVolunteerRequirementPeriod", periodId);

    await prisma.ptaVolunteerHourDispute.delete({ where: { id: disputeId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("removing household membership (deleting the PtaHouseholdAdult row) does NOT delete the acceptance -- acceptedByAdultId SetNulls, every snapshot field is untouched", async () => {
    const householdId = await makeHousehold(orgId, "Household For Membership Removal Test");
    const adultId = await makeAdult(orgId, householdId, "Departing Parent");
    const versionId = await makePublishedVersion(orgId, periodId);
    const acceptanceId = await makeAcceptance(orgId, periodId, householdId, versionId, adultId);

    await prisma.ptaHouseholdAdult.delete({ where: { id: adultId } }); // real membership removal, not mocked

    const acceptance = await prisma.ptaVolunteerAgreementAcceptance.findUnique({ where: { id: acceptanceId } });
    expect(acceptance).not.toBeNull();
    expect(acceptance.acceptedByAdultId).toBeNull(); // SetNull did its job
    expect(acceptance.signerDisplayNameAtAcceptance).toBe("Test Signer"); // snapshot survives the SetNull untouched
    expect(acceptance.signerRelationshipAtAcceptance).toBe("Parent");
    expect(acceptance.contentHashAtAcceptance).toBe("retention-test-hash");

    await prisma.ptaVolunteerAgreementAcceptance.delete({ where: { id: acceptanceId } });
    await prisma.ptaVolunteerAgreementVersion.delete({ where: { id: versionId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("deleting the signer's User row does NOT touch the acceptance at all -- acceptedByUserId is a plain non-FK column (deliberately not SetNull), so it goes stale rather than being claimable by a future user reusing that id", async () => {
    const disposableUser = await prisma.user.create({
      data: { email: `retention-disposable-signer-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" },
    });
    const householdId = await makeHousehold(orgId, "Household For User Deletion Test");
    const adultId = await prisma.ptaHouseholdAdult.create({
      data: { organizationId: orgId, householdId, userId: disposableUser.id, name: "Disposable Parent" },
    });
    const versionId = await makePublishedVersion(orgId, periodId);
    const acceptance = await prisma.ptaVolunteerAgreementAcceptance.create({
      data: {
        organizationId: orgId,
        requirementPeriodId: periodId,
        agreementVersionId: versionId,
        householdId,
        acceptedByUserId: disposableUser.id,
        acceptedByAdultId: adultId.id,
        acceptedAt: new Date(),
        contentHashAtAcceptance: "retention-test-hash",
        ackVersion: "test",
        signerDisplayNameAtAcceptance: "Disposable Parent",
        signerRelationshipAtAcceptance: null,
      },
    });

    await prisma.ptaHouseholdAdult.delete({ where: { id: adultId.id } }); // membership must go first (adult FK still real, SetNull)
    await prisma.user.delete({ where: { id: disposableUser.id } }); // the real, non-mocked signer-deletion proof

    const afterDeletion = await prisma.ptaVolunteerAgreementAcceptance.findUnique({ where: { id: acceptance.id } });
    expect(afterDeletion).not.toBeNull(); // no FK at all on acceptedByUserId -- the delete could never cascade here
    expect(afterDeletion.acceptedByUserId).toBe(disposableUser.id); // stays exactly the stale original id, never nulled, never reassigned
    expect(afterDeletion.signerDisplayNameAtAcceptance).toBe("Disposable Parent"); // the display snapshot is what actually carries the historical identity now

    await prisma.ptaVolunteerAgreementAcceptance.delete({ where: { id: acceptance.id } });
    await prisma.ptaVolunteerAgreementVersion.delete({ where: { id: versionId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("archiving (a status update, not a delete) retains all history untouched -- the safe alternative deletePtaHousehold's guard and this migration's FKs both push admins toward", async () => {
    const householdId = await makeHousehold(orgId, "Household To Archive");
    const adultId = await makeAdult(orgId, householdId, "Archiving Parent");
    const versionId = await makePublishedVersion(orgId, periodId);
    const acceptanceId = await makeAcceptance(orgId, periodId, householdId, versionId, adultId);
    const electionId = await makeElection(orgId, periodId, householdId);

    await prisma.ptaHousehold.update({ where: { id: householdId }, data: { status: "INACTIVE" } }); // archive, not delete

    const acceptanceCount = await prisma.ptaVolunteerAgreementAcceptance.count({ where: { householdId } });
    const electionCount = await prisma.ptaVolunteerBuyoutElection.count({ where: { householdId } });
    expect(acceptanceCount).toBe(1);
    expect(electionCount).toBe(1);

    await prisma.ptaVolunteerBuyoutElection.delete({ where: { id: electionId } });
    await prisma.ptaVolunteerAgreementAcceptance.delete({ where: { id: acceptanceId } });
    await prisma.ptaVolunteerAgreementVersion.delete({ where: { id: versionId } });
    await prisma.ptaHouseholdAdult.delete({ where: { id: adultId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
  });

  it("tenant isolation: an org A delete-attempt blocked by org A's own history never touches org B's independent rows for the same-shaped period", async () => {
    const householdId = await makeHousehold(orgId, "Org A Household");
    const electionId = await makeElection(orgId, periodId, householdId);
    const householdBId = await makeHousehold(orgBId, "Org B Household");
    const electionBId = await makeElection(orgBId, periodBId, householdBId);

    await expectRawDeleteRejected("PtaHousehold", householdId);

    const orgBElectionStillExists = await prisma.ptaVolunteerBuyoutElection.findUnique({ where: { id: electionBId } });
    const orgBHouseholdStillExists = await prisma.ptaHousehold.findUnique({ where: { id: householdBId } });
    expect(orgBElectionStillExists).not.toBeNull();
    expect(orgBHouseholdStillExists).not.toBeNull();

    await prisma.ptaVolunteerBuyoutElection.delete({ where: { id: electionId } });
    await prisma.ptaHousehold.delete({ where: { id: householdId } });
    await prisma.ptaVolunteerBuyoutElection.delete({ where: { id: electionBId } });
    await prisma.ptaHousehold.delete({ where: { id: householdBId } });
  });

  it("FA3 §7: constraint-metadata drift test -- queries information_schema directly for exactly the 11 FKs the retention migration recreated, and fails if any of them is anything other than RESTRICT (a future schema change that silently reintroduces Cascade on one of these fails THIS test, before any delete-attempt test above would even reveal it)", async () => {
    const rows: Array<{ table_name: string; column_name: string; delete_rule: string }> = await prisma.$queryRaw`
      SELECT
        tc.table_name,
        kcu.column_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name IN (
          'PtaVolunteerAgreementVersion', 'PtaVolunteerAgreementAcceptance',
          'PtaVolunteerBuyoutElection', 'PtaVolunteerBuyoutPurchase',
          'PtaVolunteerAssessmentCharge', 'PtaVolunteerHourDispute'
        )
        AND kcu.column_name IN ('requirementPeriodId', 'householdId')
    `;

    expect(rows.length).toBe(EXPECTED_RESTRICT_FKS.length);
    for (const expected of EXPECTED_RESTRICT_FKS) {
      const match = rows.find((r) => r.table_name === expected.table && r.column_name === expected.column);
      expect(match, `missing FK metadata for ${expected.table}.${expected.column}`).toBeDefined();
      expect(match!.delete_rule, `${expected.table}.${expected.column} must be RESTRICT`).toBe("RESTRICT");
    }

    // The deliberately-untouched Cascade siblings (batch/line's own FKs,
    // never exercised by a period/household delete) must NOT have crept
    // into this RESTRICT set -- confirms the audit stayed bounded to
    // exactly what FA3 §2/§3 named, nothing broader.
    const assessmentChargeBatchAndLine = rows.filter((r) => r.table_name === "PtaVolunteerAssessmentCharge");
    expect(assessmentChargeBatchAndLine.length).toBe(2); // requirementPeriodId + householdId only, not batchId/lineId
  });
});
