# `PtaVolunteerRateLockTiming` enum migration — RV-8 review

`fix/pta-volunteer-financial-controls`, RV-8. Full empirical review of
`prisma/migrations/20260830141344_pta_volunteer_rate_lock_timing_election_checkout/migration.sql`
(the `CHECKOUT_START | PAYMENT_SUCCESS` → `ELECTION | CHECKOUT` rename FC-4's
design note calls for — see that doc's §2-3, §9). Every claim below was
re-verified fresh against real Postgres (local dev and read-only production)
during this review, not carried forward from an earlier report.

## Complete migration SQL

```sql
-- AlterEnum
BEGIN;
CREATE TYPE "PtaVolunteerRateLockTiming_new" AS ENUM ('ELECTION', 'CHECKOUT');
ALTER TABLE "PtaVolunteerPricingWindow" ALTER COLUMN "lockTiming" DROP DEFAULT;
ALTER TABLE "PtaVolunteerPricingWindow" ALTER COLUMN "lockTiming" TYPE "PtaVolunteerRateLockTiming_new" USING ("lockTiming"::text::"PtaVolunteerRateLockTiming_new");
ALTER TYPE "PtaVolunteerRateLockTiming" RENAME TO "PtaVolunteerRateLockTiming_old";
ALTER TYPE "PtaVolunteerRateLockTiming_new" RENAME TO "PtaVolunteerRateLockTiming";
DROP TYPE "PtaVolunteerRateLockTiming_old";
ALTER TABLE "PtaVolunteerPricingWindow" ALTER COLUMN "lockTiming" SET DEFAULT 'CHECKOUT';
COMMIT;
```

This is Prisma's standard generated pattern for a full enum-value
replacement (not `ALTER TYPE ... ADD VALUE`, which Postgres cannot run
inside the same transaction it's then used in — this migration avoids that
restriction entirely by creating a parallel type and swapping it in).

> **Correction (deployment-gate review, pre-commit):** Prisma's raw
> generator output originally repeated `ALTER TABLE
> "PtaVolunteerPricingWindow" ALTER COLUMN "lockTiming" SET DEFAULT
> 'CHECKOUT'` a second time, in a separate `-- AlterTable` block after
> `COMMIT`. There is no PostgreSQL reason a default needs to be set twice —
> this is Prisma's diff engine independently detecting "enum type changed"
> and "column default changed" as two separate schema-diff entries even
> though one hand-authored `AlterEnum` block already resolves both. The
> duplicate statement was harmless (idempotently re-applying the same
> already-correct default) but not authoritative — removed so there is
> exactly one default-setting operation, inside the same atomic
> transaction as the rest of the enum swap. The SQL above reflects the
> corrected file; all verified claims below were re-checked against this
> corrected version, not the original.

## Verified claims

**1. Current production row count for the affected column is zero.**
Read-only query against production, re-run during this review:
`SELECT count(*) FROM "PtaVolunteerPricingWindow"` → **0**. There is no
existing data this migration could misinterpret or lose.

**2. No unrelated table uses the enum.** Queried Postgres's own catalog
against local dev (schema-identical to production for this purpose):
`SELECT table_name, column_name FROM information_schema.columns WHERE
udt_name = 'PtaVolunteerRateLockTiming'` → exactly one row:
`PtaVolunteerPricingWindow.lockTiming`. Confirmed via `pg_enum` that the
live values are exactly `ELECTION`, `CHECKOUT` (no stray old labels), and
via `information_schema.columns.column_default` that the column has
exactly one default, `'CHECKOUT'::"PtaVolunteerRateLockTiming"` — confirmed
against the corrected, de-duplicated migration file (see the correction
note above).

**3. Whether deployed old code can read/write during the gap, and whether a
failed deployment leaves production recoverable.** This app's documented
deployment workflow (`docs/production-deployment.md`, step 2 vs step 3) runs
`prisma migrate deploy` against production MANUALLY, separately from and
before the `git push` that triggers the actual app deployment — there is no
automated release-phase hook coupling the two. That means there is a real,
non-zero window where the OLD app code (whatever is currently live) runs
against the NEW schema before the new code takes over.

Precisely characterized: old code's write path
(`pricing.ts: createPricingWindow`, pre-this-branch) would attempt to
persist a `lockTiming` value drawn from the OLD enum
(`CHECKOUT_START`/`PAYMENT_SUCCESS`, defaulting to `CHECKOUT_START`) into a
column now typed with the NEW enum — Postgres rejects this as an invalid
enum value, so any write during the gap fails loudly (a request-level
error), never silently corrupting data. The reverse ordering (new code
deployed before the migration runs) has the mirror-image failure mode. **In
practice this gap is unreachable today**, verified fresh against production
during this review:
`SELECT count(*) FROM "PtaProfile" WHERE "ptaVolunteerBuyoutEnabled" = true`
→ **0** — the pricing-window feature (and therefore the only code path that
ever writes `lockTiming`) is gated off for every production organization,
platform-flag-first per `requireVolunteerHoursAccess`. A failed deployment
after the migration but before the app cutover therefore leaves production
in a state with an updated (harmless, currently-unused) enum type and zero
rows anywhere that could be affected — trivially recoverable, since there is
nothing to recover.

**No staged/compatibility-interval migration is required for this specific
case** — not because the theoretical gap doesn't exist (it does, for any
enum rename under this app's current manual-migrate-then-push workflow),
but because the write path it could affect is provably unreachable in
production today. This determination is specific to zero-row,
fully-flag-gated tables; it is not a general exemption from staging
enum changes on live, populated, reachable tables.

**4. `PAYMENT_SUCCESS` was not removed unsafely.** FC-4's own investigation
(this design note's §1) already established `PAYMENT_SUCCESS` was dead
configuration from the moment it was introduced — grepped the entire `src/`
tree and found no code path ever branched on `lockTiming`'s value at
runtime; it was a stored, admin-selectable label with zero wired behavior.
Combined with the zero-row confirmation above, its removal deletes an inert
label, not a load-bearing one.

**5. Rollback/forward recovery.** Every DDL statement in this migration
(`CREATE TYPE`, `ALTER TABLE ... TYPE ... USING`, `ALTER TYPE ... RENAME`,
`DROP TYPE`) is fully transactional in PostgreSQL and is wrapped in an
explicit `BEGIN`/`COMMIT` — a failure at any statement rolls back the entire
enum swap atomically, leaving the OLD type and column exactly as they were.
This project does not write down-migrations for any historical migration
(none exist anywhere in `prisma/migrations/`); given zero rows exist, a
"rollback" is equivalent to simply not having applied the migration at
all — there is no data-loss scenario to guard against with a reverse script.

**6. Local production-equivalent apply succeeds from the exact current
production schema.** `npx prisma migrate status` run against production
(read-only — confirms history, applies nothing) reports the migration
history is clean and lists this migration as the correct next pending one,
with no drift and no unresolved failed migrations. Separately, this exact
migration was already applied to the local dev DB (`civicflow_dev`) earlier
in this correction round, on a base identical to production's 116
already-applied migrations: `_prisma_migrations` shows it completed in one
step with no error logs
(`started_at`/`finished_at` both populated, `applied_steps_count: 1`,
`logs` empty).

**7. Prisma migration status remains clean.** Confirmed directly:
`npx prisma migrate status` against production reports exactly three
not-yet-applied migrations (this one plus RV-2's and RV-10's index
migrations, all from this same uncommitted branch) with no schema drift and
no error state — production's migration history is exactly what it should
be given nothing from this branch has been applied yet.

## Determination

Safe to apply as written, in the order it already exists in
`prisma/migrations/`. No changes made to the migration file itself during
this review — it was already correct; this document is the verification
record the review asked for.
