import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * fix/pta-volunteer-financial-controls, FC-8 — real-database concurrency
 * test for PtaVolunteerAssessmentCharge's partial unique index (see the
 * schema-drift warning on that model and the migration
 * 20260830144659_pta_volunteer_assessment_charge_dedupe/migration.sql).
 * Mocked unit tests (assessments.test.ts) can only prove the code *calls*
 * the right conditional queries and correctly interprets a simulated P2002;
 * they cannot prove real Postgres actually blocks the second insert under
 * genuine concurrent load, or that Prisma's error shape for an
 * index-Prisma-doesn't-know-about is what `isDuplicateChargeConstraintViolation`
 * expects. Mirrors property-resident-concurrency.integration.test.ts's
 * structure and skip convention exactly.
 *
 * Deliberately creates TWO DRAFT batches directly at the database layer
 * (bypassing previewAssessmentBatch's own single-DRAFT-per-period reuse
 * logic, which only guards its own single call path) — this is the only
 * way to reproduce two independently-postable batches both targeting the
 * same household+period, which is exactly the scenario FC-8 exists to
 * close (a supplemental/correction batch, or any two batches created by
 * different admins/requests, targeting overlapping households).
 *
 * Skipped by default (no live DB in a normal `vitest run`) — run with
 * DATABASE_URL pointed at a disposable/local Postgres BEFORE starting vitest:
 *   DATABASE_URL="postgresql://postgres@localhost:5433/civicflow_dev" \
 *   PTA_VOLUNTEER_ASSESSMENT_DEDUPE_RUN_DB_INTEGRATION_TEST=1 \
 *     npx vitest run src/lib/labs/pta/volunteer-hours/__tests__/assessment-charge-dedupe-concurrency.integration.test.ts
 * Never point this at a shared or production database; it creates and
 * deletes real rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_INTEGRATION = Boolean(DATABASE_URL) && process.env.PTA_VOLUNTEER_ASSESSMENT_DEDUPE_RUN_DB_INTEGRATION_TEST === "1";

// RV-11: this suite exercises real postAssessmentBatch calls against a real
// database — it is not testing the posting kill-switch itself (that's
// assessments.test.ts's job, fully mocked), so the switch is forced on here
// before getServerEnv() is ever first called (it caches on first call).
process.env.PTA_VOLUNTEER_ASSESSMENT_POSTING_ENABLED = "1";

describe.skipIf(!RUN_INTEGRATION)("PtaVolunteerAssessmentCharge — real duplicate-charge concurrency", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let orgId: string;
  let householdId: string;
  let periodId: string;
  let windowId: string;
  let actorUserId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    const org = await prisma.organization.create({
      data: { slug: `pta-assessment-dedupe-${Date.now()}`, name: "Assessment Dedupe Test PTA", primaryVertical: "PTA" },
    });
    orgId = org.id;

    const actor = await prisma.user.create({ data: { email: `assessment-dedupe-actor-${Date.now()}@example.test`, passwordHash: "test-hash-not-real" } });
    actorUserId = actor.id;

    const household = await prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: "Test Household", status: "ACTIVE", schoolYear: "2026-2027" },
    });
    householdId = household.id;

    const now = new Date();
    const period = await prisma.ptaVolunteerRequirementPeriod.create({
      data: {
        organizationId: orgId,
        name: "Dedupe Test Period",
        periodType: "SCHOOL_YEAR",
        startsOn: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endsOn: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        requiredMinutesDefault: 1200,
        status: "ACTIVE",
      },
    });
    periodId = period.id;

    const window = await prisma.ptaVolunteerPricingWindow.create({
      data: {
        organizationId: orgId,
        periodId,
        name: "Final assessment rate",
        startAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        timezone: "America/New_York",
        rateType: "FINAL_ASSESSMENT",
        amountCents: 2_500,
        active: true,
      },
    });
    windowId = window.id;
  });

  it("RV-10: the partial unique index exists in Postgres with exactly the documented name, columns, and predicate", async () => {
    const rows: { indexdef: string }[] = await prisma.$queryRawUnsafe(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'PtaVolunteerAssessmentCharge' AND indexname = 'PtaVolunteerAssessmentCharge_org_period_household_active'`
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;
    // Columns, in order.
    expect(def).toContain('("organizationId", "requirementPeriodId", "householdId")');
    // The corrected explicit positive-list predicate (RV-10) — not a bare
    // "!= VOID" exclusion. If a future `prisma migrate diff` silently drops
    // and regenerates this index with the wrong predicate (or drops it
    // entirely), this assertion is what catches it.
    expect(def).toMatch(/WHERE \(status = ANY \(ARRAY\['PENDING'::"PtaVolunteerAssessmentChargeStatus", 'PARTIAL'::"PtaVolunteerAssessmentChargeStatus", 'PAID'::"PtaVolunteerAssessmentChargeStatus"\]\)\)/);
    expect(def).not.toContain("VOID");
  });

  afterAll(async () => {
    await prisma?.ptaVolunteerAssessmentCharge.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerAssessmentLine.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerAssessmentBatch.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerPricingWindow.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaVolunteerRequirementPeriod.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.ptaHousehold.deleteMany({ where: { organizationId: orgId } }).catch(() => {});
    await prisma?.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma?.user.delete({ where: { id: actorUserId } }).catch(() => {});
    await prisma?.$disconnect();
  });

  async function createDraftBatchTargetingHousehold() {
    return prisma.ptaVolunteerAssessmentBatch.create({
      data: {
        organizationId: orgId,
        requirementPeriodId: periodId,
        status: "DRAFT",
        rateCents: 2_500,
        pricingWindowId: windowId,
        previewedByUserId: actorUserId,
        lines: {
          create: [
            {
              organizationId: orgId,
              householdId,
              adjustedRequiredMinutes: 1200,
              verifiedMinutes: 0,
              purchasedMinutes: 0,
              creditMinutes: 0,
              waivedMinutes: 0,
              remainingMinutes: 1200,
              assessmentCents: 50_000, // 20h * $25 -- FC-7's post-time re-verification will recompute this fresh anyway
              status: "INCLUDED",
            },
          ],
        },
      },
    });
  }

  it("sequential: the second of two independently-posted batches for the same household+period auto-excludes rather than double-charging", async () => {
    const { postAssessmentBatch } = await import("../assessments");

    const batchA = await createDraftBatchTargetingHousehold();
    const resultA = await postAssessmentBatch(orgId, batchA.id, { userId: actorUserId });
    expect(resultA.charges).toHaveLength(1);
    expect(resultA.batchFullyPosted).toBe(true);

    const batchB = await createDraftBatchTargetingHousehold();
    const resultB = await postAssessmentBatch(orgId, batchB.id, { userId: actorUserId });
    expect(resultB.charges).toHaveLength(0); // auto-excluded, not thrown, not double-charged
    expect(resultB.batchFullyPosted).toBe(true);

    const lineB = await prisma.ptaVolunteerAssessmentLine.findFirst({ where: { batchId: batchB.id, householdId } });
    expect(lineB.status).toBe("EXCLUDED");
    expect(lineB.excludeReason).toContain("already has an active assessment charge");

    const activeCharges = await prisma.ptaVolunteerAssessmentCharge.findMany({
      where: { organizationId: orgId, requirementPeriodId: periodId, householdId, status: { not: "VOID" } },
    });
    expect(activeCharges).toHaveLength(1);

    await prisma.ptaVolunteerAssessmentCharge.deleteMany({ where: { organizationId: orgId, householdId } });
    await prisma.ptaVolunteerAssessmentLine.deleteMany({ where: { organizationId: orgId, householdId } });
    await prisma.ptaVolunteerAssessmentBatch.deleteMany({ where: { organizationId: orgId } });
  });

  it("real concurrency: exactly one of 5 simultaneous posts of 5 independent batches for the same household+period creates a charge", async () => {
    const { postAssessmentBatch } = await import("../assessments");

    const batches = await Promise.all(Array.from({ length: 5 }, () => createDraftBatchTargetingHousehold()));

    const results = await Promise.allSettled(batches.map((b: { id: string }) => postAssessmentBatch(orgId, b.id, { userId: actorUserId })));

    // Every call resolves (none throw) -- a lost race is handled gracefully
    // (auto-excluded), not surfaced as an unhandled rejection.
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof postAssessmentBatch>>> => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(5);

    const withACharge = fulfilled.filter((r) => r.value.charges.length === 1);
    const withoutACharge = fulfilled.filter((r) => r.value.charges.length === 0);
    expect(withACharge).toHaveLength(1);
    expect(withoutACharge).toHaveLength(4);

    // The database itself must agree -- exactly one non-VOID charge, proving
    // the partial unique index (not just the returned promises) stayed
    // consistent under real concurrent load.
    const activeCharges = await prisma.ptaVolunteerAssessmentCharge.count({
      where: { organizationId: orgId, requirementPeriodId: periodId, householdId, status: { not: "VOID" } },
    });
    expect(activeCharges).toBe(1);

    await prisma.ptaVolunteerAssessmentCharge.deleteMany({ where: { organizationId: orgId, householdId } });
    await prisma.ptaVolunteerAssessmentLine.deleteMany({ where: { organizationId: orgId, householdId } });
    await prisma.ptaVolunteerAssessmentBatch.deleteMany({ where: { organizationId: orgId } });
  });

  /** RV-9: a second household so a batch can have multiple lines -- crash
   * simulation needs at least 2 lines to prove "resume finishes the REST,
   * doesn't redo or skip what already succeeded." */
  let extraHouseholdCounter = 0;
  async function createSecondHousehold() {
    extraHouseholdCounter += 1;
    return prisma.ptaHousehold.create({
      data: { organizationId: orgId, displayName: `Extra Household ${extraHouseholdCounter}-${Date.now()}`, status: "ACTIVE", schoolYear: "2026-2027" },
    });
  }

  async function createDraftBatchTargetingHouseholds(householdIds: string[]) {
    return prisma.ptaVolunteerAssessmentBatch.create({
      data: {
        organizationId: orgId,
        requirementPeriodId: periodId,
        status: "DRAFT",
        rateCents: 2_500,
        pricingWindowId: windowId,
        previewedByUserId: actorUserId,
        lines: {
          create: householdIds.map((hhId) => ({
            organizationId: orgId,
            householdId: hhId,
            adjustedRequiredMinutes: 1200,
            verifiedMinutes: 0,
            purchasedMinutes: 0,
            creditMinutes: 0,
            waivedMinutes: 0,
            remainingMinutes: 1200,
            assessmentCents: 50_000,
            status: "INCLUDED",
          })),
        },
      },
    });
  }

  it("RV-9: crash simulation -- a batch stuck POSTED with unresolved lines (simulating a crash between claim and finishing the loop) resumes and finishes exactly the remaining lines, without redoing the already-processed one", async () => {
    const secondHousehold = await createSecondHousehold();
    const batch = await createDraftBatchTargetingHouseholds([householdId, secondHousehold.id]);

    // Simulate "the process crashed after claiming DRAFT->POSTED and after
    // finishing line 1, but before reaching line 2" directly at the
    // database layer -- this is exactly the stuck state the pre-RV-9
    // version of postAssessmentBatch could leave behind with no way back.
    const lineForHousehold1 = await prisma.ptaVolunteerAssessmentLine.findFirstOrThrow({ where: { batchId: batch.id, householdId } });
    const lineForHousehold2 = await prisma.ptaVolunteerAssessmentLine.findFirstOrThrow({ where: { batchId: batch.id, householdId: secondHousehold.id } });
    const preCrashCharge = await prisma.ptaVolunteerAssessmentCharge.create({
      data: {
        organizationId: orgId,
        requirementPeriodId: periodId,
        householdId,
        batchId: batch.id,
        lineId: lineForHousehold1.id,
        amountCents: 12_500,
      },
    });
    await prisma.ptaVolunteerAssessmentLine.update({ where: { id: lineForHousehold1.id }, data: { status: "POSTED" } });
    await prisma.ptaVolunteerAssessmentBatch.update({ where: { id: batch.id }, data: { status: "POSTED", postedAt: new Date(), postedByUserId: actorUserId } });
    // lineForHousehold2 is deliberately left INCLUDED -- the "crash" left it unprocessed.

    const { postAssessmentBatch } = await import("../assessments");
    const resumeResult = await postAssessmentBatch(orgId, batch.id, { userId: actorUserId });

    // Resume must finish ONLY the remaining line -- never re-touch the
    // already-POSTED line or its already-created charge.
    expect(resumeResult.charges).toHaveLength(1);
    expect(resumeResult.charges[0].householdId).toBe(secondHousehold.id);
    expect(resumeResult.batchFullyPosted).toBe(true);
    expect(resumeResult.remainingLineCount).toBe(0);

    const refreshedLine1 = await prisma.ptaVolunteerAssessmentLine.findUniqueOrThrow({ where: { id: lineForHousehold1.id } });
    expect(refreshedLine1.status).toBe("POSTED");
    const refreshedLine2 = await prisma.ptaVolunteerAssessmentLine.findUniqueOrThrow({ where: { id: lineForHousehold2.id } });
    expect(refreshedLine2.status).toBe("POSTED");

    const chargesForBatch = await prisma.ptaVolunteerAssessmentCharge.count({ where: { batchId: batch.id } });
    expect(chargesForBatch).toBe(2); // the pre-crash charge, plus exactly one new one -- never a duplicate for household 1
    const chargeForHousehold1 = await prisma.ptaVolunteerAssessmentCharge.findUniqueOrThrow({ where: { id: preCrashCharge.id } });
    expect(chargeForHousehold1.amountCents).toBe(12_500); // untouched by the resume

    await prisma.ptaVolunteerAssessmentCharge.deleteMany({ where: { batchId: batch.id } });
    await prisma.ptaVolunteerAssessmentLine.deleteMany({ where: { batchId: batch.id } });
    await prisma.ptaVolunteerAssessmentBatch.deleteMany({ where: { id: batch.id } });
    await prisma.ptaHousehold.delete({ where: { id: secondHousehold.id } });
  });

  it("RV-9: a genuinely no-op resume (batch already POSTED, zero INCLUDED lines remaining) returns idempotently without creating anything new", async () => {
    const batch = await createDraftBatchTargetingHousehold();
    const { postAssessmentBatch } = await import("../assessments");
    const first = await postAssessmentBatch(orgId, batch.id, { userId: actorUserId });
    expect(first.batchFullyPosted).toBe(true);

    const second = await postAssessmentBatch(orgId, batch.id, { userId: actorUserId });
    expect(second).toEqual({ charges: [], batchFullyPosted: true, remainingLineCount: 0 });

    const chargesForBatch = await prisma.ptaVolunteerAssessmentCharge.count({ where: { batchId: batch.id } });
    expect(chargesForBatch).toBe(first.charges.length); // the second call created nothing extra

    await prisma.ptaVolunteerAssessmentCharge.deleteMany({ where: { batchId: batch.id } });
    await prisma.ptaVolunteerAssessmentLine.deleteMany({ where: { batchId: batch.id } });
    await prisma.ptaVolunteerAssessmentBatch.deleteMany({ where: { id: batch.id } });
  });

  it("RV-9: real concurrency -- two simultaneous resume calls on the SAME stuck batch never both charge the same remaining household, and neither clobbers the other's line status", async () => {
    const households = await Promise.all(Array.from({ length: 5 }, () => createSecondHousehold()));
    const batch = await createDraftBatchTargetingHouseholds(households.map((h) => h.id));
    // Simulate the batch already having been claimed (POSTED) by a crashed
    // first attempt, with all 5 lines still INCLUDED (crash happened
    // immediately after the claim, before any line was touched).
    await prisma.ptaVolunteerAssessmentBatch.update({ where: { id: batch.id }, data: { status: "POSTED", postedAt: new Date(), postedByUserId: actorUserId } });

    const { postAssessmentBatch } = await import("../assessments");
    const results = await Promise.all(
      Array.from({ length: 2 }, () => postAssessmentBatch(orgId, batch.id, { userId: actorUserId }))
    );

    // Together, the two concurrent resume calls must account for all 5
    // households exactly once each -- never zero, never duplicated.
    const allChargedHouseholdIds = results.flatMap((r) => r.charges.map((c) => c.householdId)).sort();
    expect(allChargedHouseholdIds).toEqual(households.map((h) => h.id).sort());

    const finalLines = await prisma.ptaVolunteerAssessmentLine.findMany({ where: { batchId: batch.id } });
    expect(finalLines.every((l: { status: string }) => l.status === "POSTED")).toBe(true);

    const totalCharges = await prisma.ptaVolunteerAssessmentCharge.count({ where: { batchId: batch.id } });
    expect(totalCharges).toBe(5); // exactly one per household, never a duplicate from the race

    await prisma.ptaVolunteerAssessmentCharge.deleteMany({ where: { batchId: batch.id } });
    await prisma.ptaVolunteerAssessmentLine.deleteMany({ where: { batchId: batch.id } });
    await prisma.ptaVolunteerAssessmentBatch.deleteMany({ where: { id: batch.id } });
    await Promise.all(households.map((h) => prisma.ptaHousehold.delete({ where: { id: h.id } })));
  });

  it("RV-9: a CANCELLED batch is still rejected outright, even with unresolved lines -- resume never applies to a genuinely terminal state", async () => {
    const batch = await createDraftBatchTargetingHousehold();
    await prisma.ptaVolunteerAssessmentBatch.update({ where: { id: batch.id }, data: { status: "CANCELLED" } });

    const { postAssessmentBatch } = await import("../assessments");
    await expect(postAssessmentBatch(orgId, batch.id, { userId: actorUserId })).rejects.toMatchObject({ code: "PTA_VALIDATION_ERROR" });

    const line = await prisma.ptaVolunteerAssessmentLine.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(line.status).toBe("INCLUDED"); // untouched

    await prisma.ptaVolunteerAssessmentLine.deleteMany({ where: { batchId: batch.id } });
    await prisma.ptaVolunteerAssessmentBatch.deleteMany({ where: { id: batch.id } });
  });
});
