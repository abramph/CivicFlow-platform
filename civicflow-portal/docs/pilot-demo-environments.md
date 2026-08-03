# Pilot-Ready Demo Environments

All four fictional demo organizations referenced throughout this project's planning docs, in one
place, plus a real safety fix to the seed scripts themselves found while reviewing them for this
pass.

## The four demo organizations

| Vertical | Organization | Slug | Seed command |
|---|---|---|---|
| Community | Riverdale Community Association | `riverdale-community-association` | `npm run db:seed:pta-demo` (created alongside Pine Grove — see below) |
| PTA | Pine Grove School PTA | `pine-grove-school-pta` | `npm run db:seed:pta-demo` |
| Union | United Workers Local 408 | `united-workers-local-408` | `npm run db:seed:union-demo` |
| HOA | Oak Ridge Homeowners Association | `oak-ridge-homeowners-association` | `npm run db:seed:hoa-demo` |

Run `npm run db:seed:all-demos` to seed all three demo scripts (Riverdale is created as a
side-effect of the PTA script — see `prisma/seed-pta-demo.ts`'s own comment on why a second,
non-PTA org is seeded alongside Pine Grove, for cross-tenant isolation testing) in one command.

Every seed script is additive and idempotent (upsert/find-or-create throughout) — re-running any of
them is always safe and never duplicates data or touches another organization's records. None of
them run automatically in any deploy pipeline.

**United Workers Local 408 is new this pass** — the Community, PTA, and HOA demo orgs already
existed; Union was the one vertical with no seed data at all. `prisma/seed-union-demo.ts` creates
officers (President/Treasurer/Office Staff), a rank-and-file member roster (including one retired
member with no login, mirroring the HOA seed's "former tenant" pattern), a dues category, a
reconciled payroll-checkoff payment-import batch, and a sent communication campaign — enough to
satisfy every step of the Union onboarding checklist.

## Real safety fix found while reviewing these scripts

Every seed script (`seed.ts`, `seed-pta-demo.ts`, `seed-hoa-demo.ts`) was calling
`loadEnvConfig(process.cwd())` with no second argument. `@next/env`'s own `loadEnvConfig(dir, dev)`
defaults `dev` to falsy when omitted, which resolves `.env.production.local > .env.local >
.env.production > .env` precedence — exactly what `.env`/`.env.local` point at in this repo
(production). Every script's own doc comment claimed "never point this at production," but nothing
in the code enforced it: running any of them as a bare `npx tsx prisma/seed-*.ts`, with no
`NODE_ENV` set, would have silently attempted to write fictional demo data into the **production**
database.

`seed-pta-demo.ts` had a second, subtler version of the same class of bug: its static top-level
import of `resolvePtaTargetMemberIds` transitively imports `@/lib/prisma` → `@prisma/client`, and
`@prisma/client` bundles its own dotenv loader that reads the plain `.env` file directly, completely
independent of `@next/env`. Because ES module static imports execute before any other top-level
code in the importing file (regardless of source-code order), that import's side effect populated
`process.env.DATABASE_URL` from the wrong file *before* the script's own env-loading call ever ran —
and since dotenv never overrides an already-set `process.env` key, the script's later, correct load
was silently a no-op. Fixed by converting that import to a dynamic `await import(...)` performed
inside `main()`, after the correct env load has already run (mirroring the pattern these scripts
already used for `@prisma/client` itself).

Both are now fixed via a shared `prisma/seed-demo-guard.ts`:
- `loadDemoEnv()` — calls `loadEnvConfig(process.cwd(), true)`, forcing development-mode env-file
  precedence so `.env.development.local` (the local disposable Postgres — see
  `docs/backup-and-disaster-recovery.md`) is actually used.
- `assertNotProduction()` — defense in depth: refuses to run, with a clear error, if the resolved
  `DATABASE_URL` host contains `civicflowprod` regardless of how it got resolved (e.g. a
  misconfigured shell with `NODE_ENV=production` explicitly exported).

Every seed script now calls `assertNotProduction()` as the first line of `main()`. Verified: each
script still runs correctly against the local dev database, is idempotent on repeat runs, and the
guard was confirmed to actually block a simulated production `DATABASE_URL`.

## What this does not include

No reset/truncate mechanism exists for these demo orgs (and none was added this pass) — every seed
script is purely additive. Restoring a "pristine" demo state requires either accepting the
accumulated state from prior runs (harmless, since seeding is idempotent) or manually clearing the
relevant rows. A destructive wipe-and-reseed script was deliberately not built in this pass: the
blast radius of a bug in a delete-based reset script pointed at the wrong database is far worse than
the inconvenience of demo data slowly accumulating, and no demonstrated need for one was identified.
