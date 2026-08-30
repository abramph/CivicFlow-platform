# Crash-safe, resumable assessment posting — RV-9

`fix/pta-volunteer-financial-controls`, RV-9. `postAssessmentBatch`
(`src/lib/labs/pta/volunteer-hours/assessments.ts`) restructured so a
process crash partway through posting a batch is recoverable, not
terminal. Every claim below is verified by a real-Postgres test —
`__tests__/assessment-charge-dedupe-concurrency.integration.test.ts`'s "RV-9"
tests — not just the mocked unit tests in `__tests__/assessments.test.ts`.

## The defect this corrects

Before RV-9, the function did one unconditional batch-level compare-and-swap
(`DRAFT` → `POSTED`) BEFORE looping over every INCLUDED line, and every
per-line write inside the loop was an unconditional `update`. If the process
crashed after the claim but before the loop finished — say, after line 3 of
10 — the batch was left permanently stuck: `status="POSTED"`, 3 lines
resolved, 7 lines still `INCLUDED`. A second call would find the batch not
`DRAFT` and immediately throw `"This batch has already been posted or
cancelled."` — there was no way back short of a manual database fix.

## What changed

1. **The batch-level claim is now conditional on need, not unconditional.**
   The function reads the batch's current `status` first. If `DRAFT`, it
   claims exactly as before (a genuine simultaneous double-post still
   throws — unchanged). If already `POSTED`, the claim step is skipped
   entirely and the function proceeds straight to processing whatever
   `INCLUDED` lines remain — this IS the resume path. A `CANCELLED` batch
   is still rejected outright, unconditionally.
2. **Every per-line write is now a conditional compare-and-swap**
   (`updateMany({ where: { id: line.id, status: "INCLUDED" }, ... })`,
   checking `count`), not an unconditional `update`. This is what makes it
   safe to run the loop against a batch's remaining lines however many
   times, including from two callers resuming the SAME batch concurrently:
   whichever caller's swap lands first wins that line; the other's swap on
   the same line matches zero rows and is silently skipped. The line-claim
   inside the charge-creation transaction happens BEFORE the charge
   `create()` — if a concurrent caller already claimed the line, no charge
   is even attempted, and the transaction returns `null`. This was the
   subtle piece the naive "call it exactly like the assessment-charge index
   already protects everything" reasoning missed: the FC-8 partial unique
   index only stops two ACTIVE charges for the same household+period — it
   does not stop a lost concurrent line-claim from clobbering the winner's
   line status update, because the constraint has no opinion on the loser's
   *own* subsequent write to a *different* row it doesn't touch. RV-9's
   test "a per-line claim lost to a concurrent resume ... never overwriting
   the winner's result" is the direct regression proof.
3. **A genuine no-op resume is a safe, cheap idempotent success.** If a
   caller invokes `postAssessmentBatch` on a batch that's already `POSTED`
   with zero remaining `INCLUDED` lines (the batch actually finished before
   this call, or a previous resume already finished it), the function
   returns `{ charges: [], batchFullyPosted: true, remainingLineCount: 0 }`
   immediately — no re-claim attempt, no audit event, no notification call.
4. **The return type now makes completeness explicit, not inferred.**
   `PostAssessmentBatchResult` is `{ charges, batchFullyPosted,
   remainingLineCount }`. `charges` is scoped to what THIS call created —
   never the batch's full historical total — so a caller can never mistake
   a partial resume's small `charges` array for the whole batch's result.
   `batchFullyPosted`/`remainingLineCount` are computed fresh via
   `prisma.ptaVolunteerAssessmentLine.count(...)` after the loop, so they
   reflect reality even if this SAME call was itself interrupted or lost a
   race for some of its lines. The one API route that calls this
   (`.../assessments/[batchId]/post/route.ts`) forwards both fields in its
   JSON response.

## Explicit answers to the review's checklist

- **Batch states while only some lines are posted**: `status="POSTED"` with
  a mix of `POSTED`/`EXCLUDED`/still-`INCLUDED` lines is now a normal,
  expected, recoverable intermediate state — not a bug. `batchFullyPosted`
  is how a caller distinguishes "done" from "still has work."
- **Crash-after-line-3-of-10**: directly tested — RV-9's "crash simulation"
  integration test creates that exact state at the database layer (one line
  `POSTED` with a real charge, one left `INCLUDED`) and proves a resume call
  finishes only the remainder, touches nothing about the already-completed
  line or its charge.
- **How the operation resumes**: call `postAssessmentBatch` again with the
  same `batchId`. No special "resume" flag or endpoint — the function
  detects the state itself from the batch's current status and remaining
  `INCLUDED` lines.
- **Already-posted lines skipped idempotently**: yes — a line whose status
  is no longer `INCLUDED` is never re-queried by the `findMany({ where: {
  status: "INCLUDED" } })` that drives the loop, so it's never revisited at
  all, let alone double-processed.
- **Can the batch be marked POSTED while lines remain unresolved?** Yes,
  transiently and by design (see "batch states" above) — this is what makes
  resumption possible instead of forcing an all-or-nothing single
  transaction (which FC-8's own reasoning already rejected: one household
  losing the duplicate-charge race must never roll back every OTHER
  household in the same batch).
- **Auto-excluded duplicate lines vs. exempt/zero-balance lines**:
  distinguishable today via `excludeReason`'s text — "Household's
  remaining-hours requirement was already fully met by the time this batch
  was posted" (zero/negative remaining) vs. "This household already has an
  active assessment charge for this period, created by another batch"
  (lost the FC-8 duplicate-charge race). Both are asserted verbatim by
  existing tests.
- **Every charge/exclusion has an audit reason**: every `EXCLUDED` line
  write includes `excludeReason` (schema-required context, not optional);
  every created charge is tied to its `lineId` and the batch-level audit
  event now additionally records `resumed`, `batchFullyPosted`, and
  `remainingLineCount` alongside the pre-existing `chargeCount`/`totalCents`.
- **Can a failed line be retried without duplicating successful ones?**
  Yes — the whole point of the conditional-swap redesign. A line that
  failed to process (still `INCLUDED` after a crash) is retried on the next
  call; a line that succeeded (`POSTED` or `EXCLUDED`) is never touched
  again.
- **Do totals reconcile after partial completion?** Yes, by construction:
  every line's terminal status is exactly one of `POSTED` (has a real
  charge, tied 1:1 via `lineId`) or `EXCLUDED` (has a reason, no charge) or
  still `INCLUDED` (counted in `remainingLineCount`) — there is no fourth
  state and no line can be silently dropped, since the loop only ever reads
  `INCLUDED` lines and every one it reads gets a conditional write attempt.
- **Do notifications wait for the correct terminal state?**
  `sendVolunteerHoursAssessmentPostedNotices` has its own PER-CHARGE dedup
  (`PtaVolunteerNotificationLog`, keyed by `charge.id`), independent of how
  many times `postAssessmentBatch` itself is called — so it is safe to call
  unconditionally on every resume (which the function still does): an
  already-notified household is filtered out by that function's own query,
  never re-notified, regardless of how many resume calls eventually finish
  the batch.
- **"A batch must not claim complete success when processing stopped
  midway"**: enforced by `batchFullyPosted` being computed from a fresh
  count, never assumed true just because the function reached its return
  statement.
