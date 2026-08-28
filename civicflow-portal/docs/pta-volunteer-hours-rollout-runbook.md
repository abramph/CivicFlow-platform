# Unestra for PTA — Volunteer Hour Requirements & Buyout: Rollout Runbook

Operational procedure for Phase 2 (staging verification → controlled production dark launch) of the Volunteer Hour Requirements, Buyouts & Reporting program. **Nothing in this document authorizes any action by itself** — every step below requires the user's explicit go-ahead at the time, per the standing constraint carried through the whole program: *do not merge, deploy, enable the feature for a real organization, submit a mobile build, or modify the current Apple submission without explicit approval.*

## Current state as of end of Phase 1 (VH-A through VH-L)

- Branch `feature/pta-volunteer-hours`, **not merged to `main`**.
- All 12 stage commits present, full test suite green (see `docs/pta-volunteer-hours.md` for exact counts per stage), typecheck/lint/production-build clean at every stage.
- Zero `civicflow-mobile` source changes.
- Zero production deployments. Zero organizations have any of the six flags enabled.
- One local migration applied to the dev database only (`civicflow_dev`) — never applied to production.

## Step 1 — Merge (requires explicit approval)

Standard PR review against `main`. Nothing about this step is unusual — it's a large diff (12 stages) but each stage's own commit message documents what it does and why. Recommend reviewing `docs/pta-volunteer-hours.md` first for the full narrative rather than reading 12 commits cold.

## Step 2 — Deploy to production (requires explicit approval)

The migration is purely additive (`CREATE TABLE`, `ADD COLUMN` with safe defaults, new enum values) — no existing table is altered destructively, no existing column is dropped/renamed/retyped. Every new `PtaProfile` flag defaults to `false`. **A production deploy of this code, by itself, changes nothing observable for any existing organization** — every new code path is gated behind a flag that starts off, and the platform kill-switch (`PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED`) provides an additional, independent off switch above all six org flags.

Before deploying:
- [ ] Confirm `PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED` is **not** set (or explicitly `false`) in the production environment, so even a mis-flagged org can't activate anything.
- [ ] Confirm the migration applies cleanly against a fresh copy/snapshot of the production schema (standard pre-deploy migration check, not specific to this feature).

## Step 3 — Staging verification

With the platform flag on in staging only:
- [ ] Full manual walkthrough on a staging demo org: period + pricing setup, family election, Stripe **test-mode** buyout, offline payment, assessment preview/post, all 7 reports generated and opened (on-screen and downloaded `.xlsx`), family self-service report download, permission boundaries (STAFF vs FINANCE vs READ_ONLY vs household self-access), cross-org isolation (a second staging org confirms it sees none of the first org's data).
- [ ] Notification preview/test-send confirmed working, sent only to a designated test inbox.
- [ ] Background report export (queue → poll → download) confirmed working end-to-end.

## Step 4 — Controlled production dark launch (requires explicit per-org approval)

**Never general availability. Never by org name — always by verified org ID.** Checklist before enabling any flag for any org ID:

- [ ] The org ID is on the **server-enforced** allowlist (`PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS`) the user has explicitly approved — not merely on an informal/documented list. Since the pilot-allowlist hardening, access requires three independent conditions together: the platform switch, this allowlist, and the org's own `PtaProfile` capability flag. An org missing any one of the three is denied, even if the other two are already set — see `docs/pta-volunteer-hours-pilot-plan.md` for the exact activation sequence.
- [ ] The org is confirmed to be a designated test/demo org, **not** a live school's real families, unless the user has explicitly approved enabling for a real org.
- [ ] The org is confirmed **not** to be an Apple or Google reviewer account. There is still no automated registry of reviewer org IDs in this codebase — this remains a manual cross-check against project records, by exact ID, never by name (a "Demo"-named, billing-exempt-looking org has been confirmed to be a reviewer org before — naming and billing status are not reliable signals). As of 2026-08-28 the pilot program's server-enforced allowlist (`PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS`, see `docs/pta-volunteer-hours-pilot-plan.md`) is the primary technical control for this — it structurally prevents any non-listed organization, reviewer accounts included, from using the feature even if RBAC or a database flag would otherwise allow it. This checklist item remains as a second, human verification layer before adding any org ID to that allowlist in the first place.
- [ ] Any requirement period created for testing is clearly labeled as test data (e.g. name prefixed `[TEST]`).
- [ ] `ptaVolunteerNotificationsEnabled` stays `false` for the org unless the user has separately authorized a specific test send to a specific test recipient — the preview/test-send endpoint (`POST periods/[periodId]/notifications/preview`) covers testing without needing this flag on at all.
- [ ] No assessment batch is posted against real families without explicit approval.
- [ ] No live (non-test-mode) Stripe payment is made without explicit approval, and only ever against a designated test org / small amount, never a real family's account.

Enabling is done through the existing SUPER_ADMIN-only org settings path — every flag flip is already audited automatically (org settings changes go through the standard audit pipeline).

## Step 5 — Monitor

- [ ] Watch `GET /api/labs/pta/volunteer-hours/audit` for the enabled org(s) for unexpected activity.
- [ ] Watch for any `PtaVolunteerReviewFlag` rows (corrections-after-posting, overpayment-after-reduction) — these are the system's own signal that something needs human judgment.
- [ ] Watch Stripe Connect webhook logs for the enabled org's connected account for any unexpected event types.

## Rollback

Always additive-safe, at any point:

1. **Flip the relevant control off** — any one of the three (platform env var, `PTA_VOLUNTEER_HOURS_ALLOWED_ORG_IDS`, or the specific org's `PtaProfile` column(s)) is independently sufficient to deny access; use whichever matches the scope of the rollback. Removing an org ID from the allowlist (or clearing the variable entirely) kills the feature for that org (or everywhere) without needing to also touch its database flags — a stored `true` flag for a de-allowlisted org is inert, never re-checked as a bypass.
2. **Effect is immediate**: every guard (`requireVolunteerHoursFlag`) re-checks the platform switch, the allowlist, and the flag on every request — there's no cache to bust, no restart needed. The cron notification sweep (`sendVolunteerHoursNotificationsAllOrganizations`) re-filters to allowlisted, flag-enabled orgs on every run, so a disabled or de-allowlisted org stops receiving new notification sends on its very next scheduled run.
3. **Nothing is deleted.** Every period, assignment, pricing window, ledger entry, purchase, assessment charge, dispute, review flag, notification log, and audit event stays exactly as it was — a re-enabled flag picks up right where it left off.
4. **If a full code rollback is ever needed** (reverting the deploy itself): safe in either order relative to the migration, per the same reasoning as the pre-existing `docs/pta-volunteer-management.md` rollback section — the additive migration causes no harm sitting unused, and the application code never assumes the new tables/columns are populated (every new query is itself gated behind the same flags).

## What this program deliberately did NOT touch (so rollback never has to consider them)

- Any existing `/api/mobile/pta/*` route or response shape (enforced by a permanent regression test).
- The legacy `PtaVolunteerRequirement` model or `getPtaVolunteerHourTotalsForHousehold()` — any org that never enables this feature keeps using exactly what it always used.
- The generic `/api/reports` (`POST`/`GET`) and `/api/attachments/[id]/download` routes — this feature deliberately built its own parallel queue/list/download routes rather than extending those, specifically so its stricter Report E permission gating couldn't be bypassed through a more permissive generic route.
