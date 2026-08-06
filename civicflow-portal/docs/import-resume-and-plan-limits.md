# Resumable Import Program — Resume and Plan-Limit Behavior (PR A)

## Batch lifecycle

```
UPLOADED -> ANALYZING -> READY_FOR_REVIEW -> IMPORTING -> COMPLETED
                                                 |
                                                 +-> PAUSED_PLAN_LIMIT -> IMPORTING (resume)
                                                 |
                                                 +-> PARTIALLY_COMPLETED (some rows still need review)
```

`CANCELED` and `FAILED` are reachable from most non-terminal states. `COMPLETED` and `CANCELED` are the only true dead ends. The full transition table is `FORWARD_TRANSITIONS` in `src/lib/imports/batch-state-machine.ts` — that table, not this document, is authoritative if they ever disagree.

## What happens when capacity runs out mid-import

`executeBatch()` (`src/lib/imports/engine.ts`) rechecks capacity via `checkImportCapacity()` **before every single capacity-consuming write**, not just once at the start of the batch. The instant it's exhausted:

1. The current row write (if in progress) finishes — no partial/torn write.
2. No further capacity-consuming rows are created.
3. Every remaining eligible row (still pending its decision's write) is marked `BLOCKED_PLAN_LIMIT` in one bulk update.
4. A snapshot — `{ allowed, used, pendingAfterUpgrade }` — is recorded on `ImportBatch.planLimitSnapshot` at that exact instant, and shown verbatim on the batch-detail UI.
5. The batch transitions to `PAUSED_PLAN_LIMIT`.

Rows that were already `SKIPPED` or `IMPORTED` before the limit was hit stay that way — nothing already done is undone or re-classified as a failure. This is the same "partial success is a real, honest outcome" precedent already established by the pre-existing `importHoaProperties()` (a property can be created even if its owner-link hits the member limit).

## Resuming

`resumeBatch()` (`src/lib/imports/engine.ts`), reachable via `POST /api/imports/[id]/resume`:

1. **Always rechecks capacity fresh.** The `planLimitSnapshot` recorded at pause time is for display only — it is never trusted as proof capacity is still available. If capacity is still exhausted, resume is rejected with `IMPORT_PLAN_LIMIT_REACHED` and the batch stays `PAUSED_PLAN_LIMIT`.
2. Transitions `PAUSED_PLAN_LIMIT -> IMPORTING`.
3. Runs an immediate first tick of `executeBatch()` — rows that were `BLOCKED_PLAN_LIMIT` keep the decision they already had (never cleared, only their `status` changed) and become eligible again automatically.
4. The batch never restarts from row one — only unprocessed/blocked eligible rows are touched.

The cron worker (`POST /api/cron/imports`, backing `src/lib/imports/engine.ts`'s `processImportQueue()`) is the mechanism that continues a resumed (or freshly started) batch across ticks if it has more eligible rows than one tick can process, or picks a stalled batch back up if the process that claimed it crashed (10-minute staleness-reclaim window, same as Meeting Intelligence's).

## Concurrency safety

Two overlapping invocations of `executeBatch()` (or `analyzeBatch()`) against the same batch cannot both process it: `claimBatchForProcessing()` is a single atomic conditional `UPDATE ... WHERE status = ? AND (claimedAt IS NULL OR claimedAt < staleThreshold)`. Only one call can win the row-level lock this produces; the other sees zero rows affected and returns immediately, doing nothing. Proven against real Postgres in `src/lib/imports/__tests__/engine.integration.test.ts` (two genuinely simultaneous `executeBatch()` calls, exactly one row of resulting `OrgMember` creation).

## Known limitation

`analyzeBatch()` currently parses and classifies an entire file in a single invocation rather than chunking across cron ticks the way `executeBatch()` does. For the row counts this program's own performance targets describe (up to 25,000 rows), this may need to be split into bounded, resumable chunks in a follow-up — tracked as a known gap, not silently claimed as solved. `executeBatch()` (the part directly tied to the plan-limit-pause requirement) is already fully chunked.
