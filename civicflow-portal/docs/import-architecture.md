# Resumable Import Program — Architecture (PR A)

## Why this exists

Before PR A, Unestra had four separate, independently-built import pathways with wildly inconsistent maturity:

| Pathway | Route | Persisted batch/rows? | File retained? | Rate limited? | Audited? |
|---|---|---|---|---|---|
| Community/PTA/HOA generic import | `/api/import` | No | No | No | No |
| Desktop migration import | `/api/migration/upload` | No | No | No | No |
| Payments/dues bulk import (incl. Union Payroll Checkoff) | `/api/payments/imports` | Yes (`PaymentImportBatch`/`PaymentImportItem`) | No | Yes | Yes |

None of them could survive a plan-limit hit mid-import, a browser refresh, or a worker retry without relying on ad hoc, per-vertical idempotency (email-match upserts, natural-key upserts). PR A builds shared, resumable infrastructure once, rather than patching each pathway independently.

## Scope of PR A

PR A is the foundation only: a real batch/row model, file-hash-based duplicate-file detection, a persisted plan-limit-pause/resume state machine, and an async checkpointed worker. It wires exactly **one** vertical end-to-end — Community members — as proof the foundation works. It deliberately does **not**:

- Build the rich duplicate-matching intelligence (email/phone/fuzzy hierarchies) — see [import-row-statuses.md](./import-row-statuses.md) for exactly what PR A does and doesn't classify.
- Roll the new engine out to PTA, HOA, or Union — those stay on the existing `/api/import`/`/api/payments/imports` pathways, untouched, until PR C.
- Build the rich side-by-side duplicate-review comparison UI — PR B's job.

## Model architecture

Two model families, deliberately not merged into one:

- **`ImportBatch`/`ImportRow`** (new in PR A) — member/household/property-shaped imports. Only `COMMUNITY_MEMBERS` is actually produced today; `PTA_HOUSEHOLDS`/`HOA_PROPERTIES` exist as `ImportKind` enum values so PR C doesn't need another migration.
- **`PaymentImportBatch`/`PaymentImportItem`** (pre-existing, used by Union Payroll Checkoff and other payment sources) — kept as-is, gaining only two new shared columns (`fileHash`, `retentionExpiresAt`) for the same file-level dedup warning. Its financial row shape (amount, matched charge, verification status) and existing item-level idempotency (a unique constraint on `(organizationId, sourceType, externalTransactionId)`) were never a good fit for a member-duplicate-review UI, and the spec is explicit that financial rows should not be forced through that UI.

## Worker/state-machine pattern

Directly modeled on `src/lib/labs/meeting-intelligence/` — the most mature resumable/checkpointed pipeline already in the codebase:

- **State-machine-as-sole-write-path** (`src/lib/imports/batch-state-machine.ts`, mirrors `state-machine.ts`): no route, worker, or UI action ever writes `ImportBatch.status` directly. `transitionImportBatch()` validates the transition against a `FORWARD_TRANSITIONS` table, is idempotent for a same-status "transition," and writes an audit event every real transition.
- **Atomic staleness-aware claim** (`src/lib/imports/engine.ts`'s `claimBatchForProcessing()`, mirrors `claimQueuedJob()`): a conditional `updateMany` (`WHERE status = expected AND (claimedAt IS NULL OR claimedAt < staleThreshold)`) so two overlapping cron ticks can never both process the same batch. 10-minute staleness window, same as Meeting Intelligence.
- **Bounded per-tick processing** (`ROWS_PER_TICK = 100` in `executeBatch()`): a batch with more eligible rows than one tick can handle simply stays `IMPORTING` and gets picked up again on the next tick — this is what makes large files survive without timing out a request, and is the direct mechanism behind pause/resume (state lives in the database between ticks, not a request-scoped variable).

## File storage

Reuses the platform's existing DigitalOcean Spaces integration (`src/lib/storage.ts`) exactly — no new bucket or credential set. `src/lib/imports/storage.ts` mirrors `meeting-intelligence/storage.ts`'s wrapper shape: structured, non-sensitive object keys (`organizations/{organizationId}/imports/{batchId}/source/{objectId}.{ext}` — no filename or PII in the key), private-only objects, a 30-day retention window matching Meeting Intelligence's own precedent.

One small, additive change to the base `src/lib/storage.ts`: a `getObjectBuffer()` helper. Every prior caller of that module only ever needed a signed URL handed to an external vendor (e.g. the transcription provider); the import worker is the first caller that needs to read a stored file's own bytes to parse it.

## Reused, not reimplemented

- Plan-limit checking: `checkMemberLimit()` (`src/lib/plan-gate.ts`) — wrapped by `src/lib/imports/capacity.ts`, never reimplemented.
- Row field mapping/normalization: `pickStr`/`buildFieldGetter`/`parseDate` (`src/lib/member-import.ts`) — imported directly by `src/lib/imports/row-normalization.ts`.
- P2002-as-idempotency: same pattern as `src/lib/hoa/violations.ts`'s `isUniqueConstraintViolation` — a retried row-analysis insert hitting the `(batchId, rowNumber)` unique constraint is caught and treated as already-processed, not an error.
- Audit logging: `createAuditEvent()` (`src/lib/audit.ts`), unchanged — impersonation handling is already centralized there.

See also: [import-resume-and-plan-limits.md](./import-resume-and-plan-limits.md), [import-row-statuses.md](./import-row-statuses.md).

## PR C — vertical rollout to PTA households and HOA properties

PR C wires `PTA_HOUSEHOLDS` and `HOA_PROPERTIES` (reserved-only `ImportKind` values since PR A) through the same engine, `src/lib/imports/duplicate-matching.ts`, and `src/lib/imports/row-normalization.ts` Community members already use — no new migration, since `ImportBatch`/`ImportRow` were already kind-agnostic. Two scope decisions, confirmed with the user before implementation:

- **Union Payroll Checkoff stays out of scope.** It has no dedicated schema and runs entirely through `PaymentImportBatch`/`PaymentImportItem` — the financial-row pipeline this program's own model-architecture decision (above) already said isn't a fit for the member-duplicate-review UI. Nothing changed on that pathway.
- **No new plan-limit dimension for households or properties.** Neither has ever consumed one. The one place HOA imports do touch the member limit — creating an owner `OrgMember` for a property row — is preserved exactly as `importHoaProperties()` (`src/lib/vertical-import.ts`) already handles it: a graceful degradation (the property still imports; only the owner link is skipped, with a note) via a direct `checkMemberLimit()` call inside `executeHoaPropertyRow()`, not the batch-level `PAUSED_PLAN_LIMIT` machinery `importKindConsumesCapacity()` gates.

Both PTA and HOA rows are created/updated exclusively through the same service-layer functions the officer UI and the old `importPtaHouseholds()`/`importHoaProperties()` already call (`createPtaHousehold`/`addPtaHouseholdAdult`/`addPtaStudent`, `createProperty`/`assignPropertyResident`) — never raw Prisma writes — so audit logging and tenant scoping are identical regardless of which path created a record. Matching uses each kind's existing deterministic identity key rather than Community's fuzzy phone/name tiers (`PtaHousehold`'s own `(organizationId, displayName, schoolYear)` unique constraint; the same `(organizationId, addressLine1, unitLabel)` exact-match `importHoaProperties()` already used), so neither kind ever produces `POSSIBLE_DUPLICATE`.

The old `/api/import` (`importPtaHouseholds`/`importHoaProperties`) and `/import` page are left completely untouched — same coexistence pattern PR A already established for Community's old `/api/import` path (still live, unlabeled) alongside the new engine's own "(Beta)" entry point.
