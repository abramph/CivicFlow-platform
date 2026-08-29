# Production build / full-repo TypeScript separation

`fix/portal-production-tsconfig-memory` — corrects the DigitalOcean build-memory
OOM that failed deployment `9017e001` (commit `f35efa5`, the report-export
queue-hardening merge). Full root-cause diagnosis lives in that conversation's
record; this doc covers the fix itself.

## Problem

`tsconfig.json`'s `include` is repo-wide (`**/*.ts`, `**/*.tsx`, excluding only
`node_modules`) — so Next.js's built-in TypeScript check during `next build`
type-checked all 1,746 project `.ts`/`.tsx` files as one program, including
the entire 391-file / 61,186-line test suite. DigitalOcean's build container
hit a real memory ceiling during that check (observed crash around ~2.5 GB of
V8 old-space usage — see the diagnostic report for full evidence). The
report-export queue-hardening branch added ~2,677 lines / 8 new files on top
of an already-tight-margin build, and it OOM'd.

## Fix

A second, production-only TypeScript project (`tsconfig.build.json`) is used
**only** for `next build`'s internal type-check, via Next's own
`typescript.tsconfigPath` config option — confirmed present and supported in
the installed Next.js 16.3.0 (`node_modules/next/dist/server/config-shared.d.ts`,
consumed in both `build/type-check.js` and `server/dev/hot-reloader-webpack.js`).
Applied only when `phase === PHASE_PRODUCTION_BUILD` (from `next/constants`),
via the standard Next.js function-config-export form — `next.config.ts`
exports a function, and Next's `normalizeConfig` calls it as
`config(phase, { defaultConfig })` (confirmed directly in
`next/dist/server/config-shared.js`). `withSentryConfig` explicitly supports
wrapping a function-form config the same way (confirmed in
`@sentry/nextjs`'s `withSentryConfig.js`), so the two compose correctly.
`next dev` never receives `typescript.tsconfigPath` and continues using
`tsconfig.json` unchanged — proven directly (see below), not assumed.

`tsconfig.build.json` **extends `tsconfig.json`** — every `compilerOptions`
value (`strict`, `target`, `skipLibCheck`, etc.) is inherited unmodified.
Nothing about type-checking strictness changed; only the *file set* changed.

## What's excluded, and why — every file accounted for

`tsc --listFilesOnly` run against both configs, project files only
(`node_modules` excluded from these counts):

| | File count |
|---|---|
| `tsconfig.json` (full) | 1,746 |
| `tsconfig.build.json` (production) | 1,347 |
| Excluded | 399 |

Every excluded file, verified — no unexplained remainder:

| Category | Count | Reason |
|---|---|---|
| `*.test.ts` / `*.test.tsx` (all under `__tests__/`) | 391 | Test code — never imported by any page/route/middleware/instrumentation entry point, so unreachable from `next build`'s module graph. Still fully checked by `typecheck:full`. |
| `scripts/platform-admin.ts`, `scripts/cloud-seat-d-grandfathering.ts` | 2 | Standalone ops CLI tools run via `tsx`, never imported by `src/`. Verified via grep — nothing under `src/` imports either file; the relationship is the reverse (`platform-admin.ts` imports `src/lib/platform-admin-cli.ts`, which stays included). |
| `vitest.config.ts` | 1 | Test-runner configuration, not part of the deployed app. |
| `prisma/seed.ts`, `prisma/seed-demo-guard.ts`, `prisma/seed-hoa-demo.ts`, `prisma/seed-pta-demo.ts`, `prisma/seed-union-demo.ts` | 5 | Standalone `tsx`-invoked database-seeding scripts. Verified: the only thing that imports `seed-demo-guard.ts` is its own test file; none of the five are reachable from `next build`'s graph. |

391 + 2 + 1 + 5 = **399**, matching exactly.

### A real gap the file-count check caught before it shipped

The first draft of `tsconfig.build.json` only listed `src/**` plus specific
root config files. Running the file-count diff surfaced `lib/apiClient.ts` —
a root-level file (**not** under `src/`) that turned out to be a one-line
re-export shim (`export * from "../src/lib/apiClient"`) genuinely imported by
three real pages (`analytics`, `dashboard`, `payments`) and `src/lib/session.ts`.
It was being excluded by omission, not by any deliberate pattern. Fixed by
adding `lib/**/*.ts` to `include`. This is exactly why the deterministic
file-listing check — not just trusting a hand-written include list — matters.

Also verified, not assumed: `src/lib/support-assistant/providers/mock-provider.ts`
and `src/lib/labs/meeting-intelligence/providers/mock-fixtures.ts` are real
production code (imported by `support-assistant/index.ts` and two live
meeting-intelligence provider implementations) despite their names — a naive
`*mock*`/`*fixture*` filename exclusion would have wrongly removed them from
the production type-check. They remain included.

### Production-surface spot-check (all present in the build config)

App Router pages: 233. API routes: 557. `src/lib` top-level modules: 125.
`src/components`: 211. Auth-related: 30. Payments/Stripe-related: 96.
Volunteer-hours-related: 139. `report-export-queue.ts`, `cron/reports/route.ts`,
`storage.ts`, `prisma.ts`, `middleware.ts`, `instrumentation.ts`: each present
exactly once, confirmed by exact-path grep, not a substring match.

## Proof the boundary actually works (not just present in config text)

Both proofs used a real, deliberate `TS2322` type error, injected and then
fully reverted (`git checkout --`) — nothing committed.

- **Production-file error**: injected into `src/lib/report-export-queue.ts`.
  `npm run typecheck:build` → exit 1, reports the error. `next build`
  (production phase, real invocation) → exit 1, fails at the "Running
  TypeScript" step with the identical error. Reverted; `git diff` empty.
- **Test-file error**: injected into
  `src/lib/__tests__/report-export-queue.test.ts`. `npm run typecheck:full`
  → exit 1 (build's `tsconfig`, tests included). `npm run typecheck:build` →
  **exit 0**, completely unaware of it. Reverted; `git diff` empty.

## Scripts

- `npm run typecheck` / `npm run typecheck:full` — unchanged, full-repo check
  (`tsconfig.json`), production source + tests + fixtures + mocks. This is
  **not currently a CI gate** — see the CI gap below.
- `npm run typecheck:build` — `tsc --noEmit -p tsconfig.build.json`,
  production-only, same as what `next build` runs internally.

## Local measurement (informational — see caveat)

Cold `.next` cache, Node 22.22.2 (matched to production), same
`--max-old-space-size=8192` flag as the real build command, on a
20-core/ample-RAM local machine:

| Build | TypeScript phase | Total build | Result | Routes |
|---|---|---|---|---|
| `f35efa5` baseline | 30.6s | 168s | success | 422 |
| Correction branch, run 1 | 31.0s | 170s | success | 422 |
| Correction branch, run 2 | 28.6s | 160s | success | 422 |

Isolated `tsc --noEmit` peak memory (multiple runs, both configs): consistently
in the 2,489–2,992 MB range regardless of which tsconfig was used — run-to-run
variance on this machine (up to ~500 MB between repeats of the *identical*
config) exceeds any difference attributable to the file-set reduction.

**Caveat, stated plainly**: this local machine has far more headroom than
DigitalOcean's build container, so it cannot reproduce the actual ceiling
(no Docker available to constrain memory to match). These numbers prove the
build **succeeds** and produces the identical 422 routes with either config —
they do not, and are not presented as, proof of a specific memory-savings
percentage. The load-bearing proof is the file-scope correctness (above) and
the error-injection tests (above), exactly as intended: fewer files parsed
into one TypeScript program is the lever DigitalOcean's own support
documentation names directly (*"a lot of small files can increase memory
overhead... try decreasing the amount of files"*), even though this session's
own hardware can't demonstrate the savings directly.

## CI recommendation (not implemented this phase)

This repository has no GitHub Actions workflow for `civicflow-portal` at all.
The two existing workflows (`build.yml`, `macos-signing-notarization.yml`) are
scoped to the Electron desktop app and only trigger on version tags, manual
dispatch, or desktop-path pull requests — never on a push to `main` that only
touches the portal. Branch protection on `main` has no required status
checks. The only gate before tonight's queue-hardening merge reached
production was DigitalOcean's own build step — which is what failed.

Recommended follow-up (separate authorization required before implementing):

- A new GitHub Actions workflow scoped to `civicflow-portal/**` changes,
  running `typecheck:full` (the complete, unweakened check), the full
  `vitest` suite, and a production `next build` on every pull request.
- Branch protection on `main` requiring that workflow to pass.
- A PR-based merge convention instead of direct pushes to `main`, so a
  build-breaking change is caught before merge, not after push.

None of this is implemented as part of this correction — deliberately, per
this phase's scope.
