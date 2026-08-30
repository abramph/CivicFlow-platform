import { Prisma } from "@prisma/client";
import { createAuditEvent } from "@/lib/audit";
import { isPtaVolunteerAssessmentPostingEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveHouseholdRequirement } from "./assignments";
import { PtaError } from "../errors";
import { getHouseholdLedgerTotals, postLedgerEntry } from "./ledger";
import { sendVolunteerHoursAssessmentPostedNotices } from "./notifications";
import { getVolunteerRequirementPeriod } from "./periods";
import { resolveVolunteerBuyoutRate } from "./pricing";

/**
 * fix/pta-volunteer-financial-controls, FC-8 (predicate corrected RV-10):
 * true for a lost race against PtaVolunteerAssessmentCharge's partial
 * unique index — "at most one charge per (organizationId,
 * requirementPeriodId, householdId) whose status is PENDING, PARTIAL, or
 * PAID" (see the schema-drift warning on that model). Mirrors
 * src/lib/hoa/properties.ts's toHoaConcurrencyError, empirically confirmed
 * against the real local dev DB in
 * __tests__/assessment-charge-dedupe-concurrency.integration.test.ts.
 */
function isDuplicateChargeConstraintViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  // Prisma reports a known (schema-declared) constraint's target as a column
  // array, but this index has no @@unique representation in schema.prisma
  // (see the model's schema-drift warning) — for an index Prisma doesn't
  // know about, Postgres/Prisma may instead report the raw index NAME as a
  // string. Handle both shapes; verified empirically against the real local
  // dev DB in __tests__/assessment-charge-dedupe-concurrency.integration.test.ts.
  if (Array.isArray(target)) return target.includes("householdId") && target.includes("requirementPeriodId");
  if (typeof target === "string") return target.includes("org_period_household_active");
  return false;
}

function computeRemainingMinutes(requiredMinutes: number, totals: Awaited<ReturnType<typeof getHouseholdLedgerTotals>>): number {
  return Math.max(0, requiredMinutes - totals.verifiedMinutes - totals.purchasedMinutes - totals.creditMinutes - totals.waivedMinutes);
}

/**
 * A pure computation with no side effects on obligations — persists a
 * DRAFT batch + one line per household with remainingMinutes > 0, so admin
 * edits/exclusions survive a page reload (spec §18). Reuses the EXISTING
 * DRAFT batch for this period if one is already in progress rather than
 * creating a duplicate — call cancelAssessmentBatch first to start over.
 */
export async function previewAssessmentBatch(
  organizationId: string,
  periodId: string,
  actor: { userId: string },
  options: { supersedesBatchId?: string | null } = {}
) {
  const existingDraft = await prisma.ptaVolunteerAssessmentBatch.findFirst({
    where: { organizationId, requirementPeriodId: periodId, status: "DRAFT" },
    include: { lines: { include: { household: { select: { displayName: true } } } } },
  });
  if (existingDraft) return existingDraft;

  const rateWindow = await resolveVolunteerBuyoutRate(organizationId, periodId, "FINAL_ASSESSMENT");
  if (!rateWindow) {
    throw new PtaError("PTA_VALIDATION_ERROR", "No final remaining-hours assessment rate is currently active for this period.");
  }

  const households = await prisma.ptaHousehold.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, displayName: true } });

  const lines: {
    organizationId: string;
    householdId: string;
    adjustedRequiredMinutes: number;
    verifiedMinutes: number;
    purchasedMinutes: number;
    creditMinutes: number;
    waivedMinutes: number;
    remainingMinutes: number;
    assessmentCents: number;
  }[] = [];

  for (const household of households) {
    const requirement = await resolveHouseholdRequirement(organizationId, periodId, household.id);
    if (requirement.exempt) continue;
    const totals = await getHouseholdLedgerTotals(organizationId, periodId, household.id);
    const remainingMinutes = computeRemainingMinutes(requirement.requiredMinutes, totals);
    if (remainingMinutes <= 0) continue;

    lines.push({
      organizationId,
      householdId: household.id,
      adjustedRequiredMinutes: requirement.requiredMinutes,
      verifiedMinutes: totals.verifiedMinutes,
      purchasedMinutes: totals.purchasedMinutes,
      creditMinutes: totals.creditMinutes,
      waivedMinutes: totals.waivedMinutes,
      remainingMinutes,
      assessmentCents: Math.round((remainingMinutes / 60) * rateWindow.amountCents),
    });
  }

  const batch = await prisma.ptaVolunteerAssessmentBatch.create({
    data: {
      organizationId,
      requirementPeriodId: periodId,
      status: "DRAFT",
      supersedesBatchId: options.supersedesBatchId ?? null,
      rateCents: rateWindow.amountCents,
      pricingWindowId: rateWindow.id,
      previewedByUserId: actor.userId,
      lines: { create: lines },
    },
    include: { lines: { include: { household: { select: { displayName: true } } } } },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "pta.volunteer_hours.assessment_batch_previewed",
    entityType: "pta_volunteer_assessment_batch",
    entityId: batch.id,
    metadata: { requirementPeriodId: periodId, lineCount: lines.length, rateCents: rateWindow.amountCents },
  });

  return batch;
}

export async function getAssessmentBatch(organizationId: string, batchId: string) {
  const batch = await prisma.ptaVolunteerAssessmentBatch.findFirst({
    where: { id: batchId, organizationId },
    include: { lines: { include: { household: { select: { displayName: true } } } } },
  });
  if (!batch) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment batch not found in this organization.");
  return batch;
}

export async function listAssessmentBatches(organizationId: string, periodId: string) {
  return prisma.ptaVolunteerAssessmentBatch.findMany({ where: { organizationId, requirementPeriodId: periodId }, orderBy: { createdAt: "desc" } });
}

async function setLineStatus(
  organizationId: string,
  batchId: string,
  lineId: string,
  status: "INCLUDED" | "EXCLUDED",
  reason: string | null,
  actor: { userId: string }
) {
  const batch = await prisma.ptaVolunteerAssessmentBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment batch not found in this organization.");
  if (batch.status !== "DRAFT") throw new PtaError("PTA_VALIDATION_ERROR", "Only a DRAFT batch's lines can be changed.");
  if (status === "EXCLUDED" && !reason?.trim()) {
    throw new PtaError("PTA_VALIDATION_ERROR", "A reason is required to exclude a family from an assessment batch.");
  }

  const line = await prisma.ptaVolunteerAssessmentLine.update({
    where: { id: lineId },
    data: { status, excludeReason: status === "EXCLUDED" ? reason!.trim() : null },
  });

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: status === "EXCLUDED" ? "pta.volunteer_hours.assessment_line_excluded" : "pta.volunteer_hours.assessment_line_included",
    entityType: "pta_volunteer_assessment_line",
    entityId: line.id,
    metadata: { batchId, reason },
  });

  return line;
}

export async function excludeAssessmentLine(organizationId: string, batchId: string, lineId: string, reason: string, actor: { userId: string }) {
  return setLineStatus(organizationId, batchId, lineId, "EXCLUDED", reason, actor);
}

export async function includeAssessmentLine(organizationId: string, batchId: string, lineId: string, actor: { userId: string }) {
  return setLineStatus(organizationId, batchId, lineId, "INCLUDED", null, actor);
}

export async function cancelAssessmentBatch(organizationId: string, batchId: string, actor: { userId: string }) {
  const updated = await prisma.ptaVolunteerAssessmentBatch.updateMany({
    where: { id: batchId, organizationId, status: "DRAFT" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (updated.count === 0) {
    throw new PtaError("PTA_VALIDATION_ERROR", "Only a DRAFT batch can be cancelled.");
  }
  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "pta.volunteer_hours.assessment_batch_cancelled",
    entityType: "pta_volunteer_assessment_batch",
    entityId: batchId,
  });
}

/**
 * fix/pta-volunteer-financial-controls, FC-7: dates must control behavior,
 * not decorate UI. `requirementPeriod.assessmentDate` was stored and shown
 * in the settings UI but never read by this file — a batch could be posted
 * at any time regardless of the configured cutoff. Preview stays available
 * anytime (it's a pure computation with no side effects, per the doc
 * comment on `previewAssessmentBatch`); only POSTING — the moment real
 * obligations are created — is gated. Boundary is open-inclusive, matching
 * FC-5's buyout-window convention: posting is allowed once
 * `now >= assessmentDate`. Never trusts a client-supplied `now`.
 */
function assertAssessmentDue(assessmentDate: Date | null, now: Date) {
  if (assessmentDate && now < assessmentDate) {
    throw new PtaError("PTA_VOLUNTEER_ASSESSMENT_NOT_YET_DUE", "This period's assessment date hasn't been reached yet.");
  }
}

/**
 * FC-7: re-derives each included line's CURRENT authoritative
 * requirement/totals/remaining-minutes right before posting — hours can
 * keep changing (a new verified entry, a correction, a buyout purchase)
 * for as long as a DRAFT batch sits unposted, and posting must charge for
 * what's actually still owed AT POST TIME, not a stale figure from whenever
 * the batch happened to be previewed. The RATE stays frozen from preview
 * (`batch.rateCents`, per the schema's own documented intent — "every
 * line's assessmentCents derives from THIS value, not a live re-resolve")
 * — only the hours are re-verified. A household that fully satisfied its
 * requirement since preview is auto-excluded (no charge), never charged a
 * stale positive amount.
 */
async function recomputeLineForPosting(
  organizationId: string,
  periodId: string,
  line: { id: string; householdId: string },
  rateCents: number
): Promise<{ verifiedMinutes: number; purchasedMinutes: number; creditMinutes: number; waivedMinutes: number; adjustedRequiredMinutes: number; remainingMinutes: number; assessmentCents: number }> {
  const requirement = await resolveHouseholdRequirement(organizationId, periodId, line.householdId);
  const totals = await getHouseholdLedgerTotals(organizationId, periodId, line.householdId);
  const remainingMinutes = requirement.exempt ? 0 : computeRemainingMinutes(requirement.requiredMinutes, totals);
  return {
    verifiedMinutes: totals.verifiedMinutes,
    purchasedMinutes: totals.purchasedMinutes,
    creditMinutes: totals.creditMinutes,
    waivedMinutes: totals.waivedMinutes,
    adjustedRequiredMinutes: requirement.requiredMinutes,
    remainingMinutes,
    assessmentCents: Math.round((remainingMinutes / 60) * rateCents),
  };
}

export interface PostAssessmentBatchResult {
  /** Charges created BY THIS CALL only — never the batch's full historical
   * total. On a resume call this is just the newly-processed remainder;
   * callers that need the whole batch's charges must query them directly
   * (`prisma.ptaVolunteerAssessmentCharge.findMany({ where: { batchId } })`),
   * never infer them from this array. */
  charges: { id: string; householdId: string; amountCents: number; lineId: string }[];
  /** RV-9: false when INCLUDED lines still remain after this call returns
   * — either because this call itself was interrupted, or because it
   * resumed a batch a PRIOR crashed call left partially processed and
   * didn't finish resolving either. A caller MUST NOT present "N charges
   * created" as if the whole batch is done when this is false — "a batch
   * must not claim complete success when processing stopped midway." */
  batchFullyPosted: boolean;
  /** Lines still in INCLUDED status after this call returns. Zero exactly
   * when batchFullyPosted is true. */
  remainingLineCount: number;
}

/**
 * RV-9: crash-safe and resumable. Every per-line write below is a
 * conditional compare-and-swap keyed on that LINE's own status
 * (`updateMany({ where: { id, status: "INCLUDED" } })`, checking `count`),
 * not an unconditional `update` — so it is always safe to re-run this
 * function against a batch that a PRIOR call left partially processed
 * (crashed after claiming DRAFT->POSTED but before finishing every line),
 * and safe for two callers to resume the SAME batch concurrently: whichever
 * caller's compare-and-swap lands first wins that specific line, and the
 * other's swap on the SAME line matches zero rows and is silently skipped
 * — no double-charge, and no line's terminal status is clobbered by a
 * loser overwriting a winner's result after the fact (the pre-RV-9 version
 * of this function updated each line unconditionally, which meant a lost
 * duplicate-charge race's EXCLUDED write could physically stomp a
 * concurrent winner's POSTED write if it happened to run second — verified
 * fixed by `__tests__/assessment-charge-dedupe-concurrency.integration.test.ts`'s
 * RV-9 tests).
 *
 * The batch-level DRAFT->POSTED compare-and-swap still exists and still
 * guards the FIRST-time claim exactly as before (a genuine simultaneous
 * double-click of "Post" on a still-DRAFT batch still throws, unchanged
 * behavior) — it is only SKIPPED when the batch is found ALREADY POSTED at
 * the initial read, which means this call is resuming, not double-claiming.
 * A CANCELLED batch is still rejected outright; a not-found batch still
 * 404s via PTA_VALIDATION_ERROR.
 *
 * Notifications remain safe to call unconditionally on every resume: their
 * own `PtaVolunteerNotificationLog` dedup (`notifications.ts:
 * sendVolunteerHoursAssessmentPostedNotices`) is keyed per-charge, not
 * per-batch-call, so a resume never re-notifies a household whose charge
 * was already announced by an earlier call.
 */
export async function postAssessmentBatch(
  organizationId: string,
  batchId: string,
  actor: { userId: string; userEmail?: string | null }
): Promise<PostAssessmentBatchResult> {
  // RV-11: assessment reversal remains a hard boundary — checked FIRST,
  // before even looking up the batch, so it is impossible to reach any
  // charge-creating code path while this is off. Deliberately does NOT gate
  // previewAssessmentBatch, excludeAssessmentLine, includeAssessmentLine,
  // or cancelAssessmentBatch — only the act of creating a real, currently
  // irreversible charge. See docs/pta-volunteer-hours-assessment-reversal-boundary.md.
  if (!isPtaVolunteerAssessmentPostingEnabled()) {
    throw new PtaError(
      "PTA_VOLUNTEER_ASSESSMENT_POSTING_BLOCKED",
      "Posting a remaining-hours assessment is temporarily disabled platform-wide — no way to adjust or reverse a posted charge exists yet. Preview remains available."
    );
  }

  const batch = await prisma.ptaVolunteerAssessmentBatch.findFirst({
    where: { id: batchId, organizationId },
    select: { requirementPeriodId: true, rateCents: true, status: true },
  });
  if (!batch) throw new PtaError("PTA_VALIDATION_ERROR", "Assessment batch not found in this organization.");
  if (batch.status !== "DRAFT" && batch.status !== "POSTED") {
    throw new PtaError("PTA_VALIDATION_ERROR", "This batch has been cancelled and cannot be posted.");
  }
  const requirementPeriod = await getVolunteerRequirementPeriod(organizationId, batch.requirementPeriodId);
  const now = new Date();
  assertAssessmentDue(requirementPeriod.assessmentDate, now);

  // Read-only re-verification happens BEFORE any write (each household's
  // fresh figures are independent, no lock needed for a read) — matching
  // this file's existing pattern of keeping transactions short. Re-running
  // this on a resume is intentional and correct, not wasted work: hours can
  // keep changing for as long as any line remains unresolved.
  const linesToRecompute = await prisma.ptaVolunteerAssessmentLine.findMany({
    where: { batchId, status: "INCLUDED" },
    select: { id: true, householdId: true },
  });
  const freshByLineId = new Map<string, Awaited<ReturnType<typeof recomputeLineForPosting>>>();
  for (const line of linesToRecompute) {
    freshByLineId.set(line.id, await recomputeLineForPosting(organizationId, batch.requirementPeriodId, line, batch.rateCents));
  }

  let didClaimThisCall = false;
  if (batch.status === "DRAFT") {
    const claimed = await prisma.ptaVolunteerAssessmentBatch.updateMany({
      where: { id: batchId, organizationId, status: "DRAFT" },
      data: { status: "POSTED", postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (claimed.count === 0) {
      throw new PtaError("PTA_VALIDATION_ERROR", "This batch has already been posted or cancelled.");
    }
    didClaimThisCall = true;
  }

  if (!didClaimThisCall && linesToRecompute.length === 0) {
    // Genuine no-op: batch was already POSTED and every line was already
    // resolved before this call started. Nothing to do, nothing new to
    // audit or notify about — a resume call on an already-fully-complete
    // batch is a safe, cheap idempotent success, not an error.
    return { charges: [], batchFullyPosted: true, remainingLineCount: 0 };
  }

  const includedLines = await prisma.ptaVolunteerAssessmentLine.findMany({ where: { batchId, status: "INCLUDED" } });

  // FC-8: each line is its own small transaction (charge create + line
  // update together, or neither) rather than one giant transaction for the
  // whole batch. Postgres aborts an ENTIRE transaction on the first
  // constraint violation — if charge creation for every household in the
  // batch shared one transaction, one household losing the duplicate-charge
  // race (FC-8's own partial unique index) would silently roll back every
  // OTHER household's legitimate charge too.
  const created: { id: string; householdId: string; amountCents: number; lineId: string }[] = [];
  for (const line of includedLines) {
    const fresh = freshByLineId.get(line.id);
    if (!fresh || fresh.remainingMinutes <= 0) {
      // RV-9: conditional on the line still being INCLUDED — a concurrent
      // resume call may have already claimed (and posted or excluded) this
      // exact line between the findMany above and this write.
      await prisma.ptaVolunteerAssessmentLine.updateMany({
        where: { id: line.id, status: "INCLUDED" },
        data: {
          status: "EXCLUDED",
          excludeReason: "Household's remaining-hours requirement was already fully met by the time this batch was posted.",
          ...(fresh ?? {}),
        },
      });
      continue;
    }

    try {
      const charge = await prisma.$transaction(async (tx) => {
        // RV-9: claims THIS line before creating its charge — if a
        // concurrent resume call already claimed it (count 0), skip
        // WITHOUT creating a charge, rather than racing on the charge
        // insert alone (which would still be duplicate-safe via FC-8's
        // index, but would leave this line's own status update to overwrite
        // whatever the concurrent winner just wrote).
        const lineClaim = await tx.ptaVolunteerAssessmentLine.updateMany({
          where: { id: line.id, status: "INCLUDED" },
          data: { ...fresh, status: "POSTED" },
        });
        if (lineClaim.count === 0) return null;
        return tx.ptaVolunteerAssessmentCharge.create({
          data: {
            organizationId,
            requirementPeriodId: batch.requirementPeriodId,
            householdId: line.householdId,
            batchId,
            lineId: line.id,
            amountCents: fresh.assessmentCents,
            dueDate: requirementPeriod.assessmentPaymentDueDate,
          },
        });
      });
      if (charge) created.push({ id: charge.id, householdId: line.householdId, amountCents: fresh.assessmentCents, lineId: line.id });
    } catch (error) {
      if (!isDuplicateChargeConstraintViolation(error)) throw error;
      // Another batch already holds the one active charge this
      // household+period may have. Never delete or overwrite that existing
      // history to make this retry succeed — this line is simply excluded,
      // not charged twice. The failed $transaction rolled back this line's
      // claim update above, so it is still INCLUDED here — safe to swap.
      await prisma.ptaVolunteerAssessmentLine.updateMany({
        where: { id: line.id, status: "INCLUDED" },
        data: {
          status: "EXCLUDED",
          excludeReason: "This household already has an active assessment charge for this period, created by another batch.",
          ...fresh,
        },
      });
    }
  }
  const charges = created;

  for (const charge of charges) {
    await postLedgerEntry({
      organizationId,
      requirementPeriodId: batch.requirementPeriodId,
      householdId: charge.householdId,
      entryType: "ASSESSMENT_CHARGE",
      amountCents: charge.amountCents,
      approvalStatus: "APPROVED",
      sourceType: "assessmentLine",
      sourceId: charge.lineId,
      description: "Remaining-hours assessment",
    });
  }

  const remainingLineCount = await prisma.ptaVolunteerAssessmentLine.count({ where: { batchId, status: "INCLUDED" } });
  const batchFullyPosted = remainingLineCount === 0;

  await createAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.userEmail ?? null,
    action: "pta.volunteer_hours.assessment_batch_posted",
    entityType: "pta_volunteer_assessment_batch",
    entityId: batchId,
    metadata: {
      chargeCount: charges.length,
      totalCents: charges.reduce((sum, c) => sum + c.amountCents, 0),
      resumed: !didClaimThisCall,
      batchFullyPosted,
      remainingLineCount,
    },
  });

  // Best-effort: the assessment is already real and correctly obligated
  // regardless of whether this email goes out, so a notification failure
  // (or the org simply having notifications off) never surfaces to the
  // caller or blocks the response. Safe to call on every resume — see the
  // function doc comment on sendVolunteerHoursAssessmentPostedNotices's own
  // per-charge dedup.
  await sendVolunteerHoursAssessmentPostedNotices(organizationId, batchId, { actorUserId: actor.userId, actorEmail: actor.userEmail }).catch(() => {});

  return { charges, batchFullyPosted, remainingLineCount };
}

/** The caller's OWN household's assessment charges — householdId is always
 * server-resolved from requirePtaHouseholdSelfAccess, never a client
 * parameter (see the /my-household/assessments route). */
export async function listHouseholdAssessmentCharges(organizationId: string, householdId: string) {
  return prisma.ptaVolunteerAssessmentCharge.findMany({ where: { organizationId, householdId }, orderBy: { createdAt: "desc" } });
}
