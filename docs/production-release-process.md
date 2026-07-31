# Unestra — Production Release Process

## Current state, honestly

There is **no staging environment and no required-checks gate** in front of production as of this writing. `civicflow-portal`'s `.do/app.yaml` has `deploy_on_push: true` on the `main` branch — merging a PR to `main` is the same action as deploying to production. `main` has basic branch protection (force-push and branch deletion blocked, added 2026-07-30) but no required status checks and no required PR review, since this is a solo-maintained project and GitHub won't let an author approve their own PR.

This document describes the process as it actually works today, plus what a real staging gate would require if one is added later.

## What actually happens on merge to `main`

1. GitHub Actions runs `build.yml` (installers) and, on `v*` tags, `macos-signing-notarization.yml`. Neither currently blocks the merge or the deploy — they're informational/artifact-producing, not release gates.
2. DigitalOcean's App Platform detects the push to `main` and starts a new deployment automatically (`deploy_on_push: true`).
3. The deployment's `run_command` is `npm run db:deploy && npm start` — **Prisma migrations run automatically as part of every deploy**, before the app starts. There is no separate migration-review or migration-approval step.
4. DigitalOcean's health check polls `GET /api/health` every 30s (10s timeout, 3-failure threshold, 30s initial delay). A deploy that fails health checks is marked failed in DigitalOcean's dashboard; it does not automatically roll back traffic.

## Pre-merge checklist (until a real staging gate exists)

Before merging anything to `main`:

- [ ] Run `scripts\windows\run-validation.ps1` locally (typecheck, lint, unit tests, Prisma validate, `expo-doctor`, dependency audit) — see `docs/windows-development.md`.
- [ ] If the change includes a Prisma migration: confirm it's additive (no destructive `DROP`/`ALTER ... DROP COLUMN` without a documented backfill plan), and that it was tested against a real disposable Postgres, not just `prisma validate`.
- [ ] If the change touches mobile push notifications, PTA Labs enrollment, or tenant-scoped queries: re-read the relevant authorization guard (`requirePtaHouseholdSelfAccess`, `requireMobilePtaHouseholdAccess`, `getOrganizationLabAccess`) to confirm tenant isolation still holds.
- [ ] Confirm the PR diff doesn't introduce a new default-enabled feature flag or Labs enrollment for any real customer organization (see "Feature flags" below).

## Post-merge / post-deploy verification

1. Watch the deploy in DigitalOcean's dashboard, or via `doctl apps list-deployments <app-id>` / `doctl apps get-deployment <app-id> <deployment-id>`.
2. Once `ACTIVE`, confirm health: `curl https://app.getunestra.com/api/health` should return `{"ok":true,"ts":...}`.
3. Check `doctl apps logs <app-id> --deployment <deployment-id> --type run` for migration errors (`Applying migration ...` should be followed by success, not a stack trace) and for any unexpected startup errors.
4. Spot-check one real feature affected by the change (not just the health endpoint) before considering the release verified.

## Feature flags / Labs enrollment

Labs verticals (PTA, meeting-intelligence, etc.) are gated per-organization via `getOrganizationLabAccess()` / enrollment records — a merge to `main` does not itself enable a new vertical for any existing customer organization. Enrollment is a separate, explicit administrative action (Platform Administrator only). Before any release that adds a new Labs vertical or capability, confirm:
- [ ] Zero unintended enrollments — no production organization gained a new capability just because the code shipped.
- [ ] The fictional demo tenant(s) (Pine Grove, Riverdale, Riverside) are the only enrollments exercised in this pass, unless a real customer explicitly requested and was granted the feature.

## What a real staging gate would need

If/when this project adds a staging environment:

1. A second DigitalOcean app (or App Platform "preview" environment) pointed at a separate database, with `deploy_on_push` disabled or scoped to a `staging` branch.
2. A required-checks GitHub branch-protection rule on `main` (portal tests, mobile tests, typecheck, lint) — currently there are no CI checks wired up as "required," so this needs both the workflow *and* the branch-protection rule.
3. A manual approval gate between staging passing and production deploying (GitHub Environments with required reviewers is the natural mechanism, given `deploy_on_push` is DigitalOcean-side rather than Actions-side).
4. The sequence described in the original task spec: `PR → validation → merge → staging → smoke tests → production approval → production → post-deploy verification`.

None of this exists yet — implementing it is a real, separate piece of infrastructure work, not a documentation exercise.

## Related documents

- `docs/rollback-plan.md` — what to do if a deploy needs to be reversed.
- `docs/app-store-review-protection.md` — constraints around the in-review iOS submission.
- `docs/macos-release-checklist.md`, `docs/macos-signing.md`, `docs/macos-notarization.md` — the signed macOS release pipeline (independent of this process).
- `docs/windows-development.md` — local development setup.
