# Unestra for PTA — Volunteer Hour Requirements, Buyouts & Reporting: Release Notes

**Status: complete, on branch `feature/pta-volunteer-hours`, not merged, not deployed, not enabled for any organization.** These notes describe what ships once this branch is merged and deployed and an organization explicitly turns the feature on — see `docs/pta-volunteer-hours-rollout-runbook.md` for how that happens.

## What's new

- **Configurable volunteer-hour requirements per family** — set a default required-hours amount per requirement period, with per-scope (grade/classroom/membership) or per-household overrides (reductions, exemptions, per-child/per-adult multipliers), all previewable before the period goes live.
- **Buy out volunteer hours** — families can pay to cover some or all of their required hours, at rates an officer configures per time window. Election (choosing an option) and payment are tracked as two distinct steps; hours are only credited once payment actually confirms.
- **Remaining-hours assessments** — at period end, officers can preview, review, and post charges for hours a family didn't complete or buy out. Posting is atomic and duplicate-proof.
- **A full Volunteer Hour Ledger** — every hour verified, purchased, waived, credited, charged, and paid is recorded in one unified, auditable ledger alongside the pre-existing raw hour-entry records.
- **A 7-report Volunteer Hours Reporting Center** — Family Summary, Detailed Activity, Event Hours, Compliance, Purchased-Hours & Financial, Individual Volunteer, and Volunteer Category reports, each viewable on screen and downloadable as a real formatted `.xlsx` workbook (bold headers, frozen panes, autofilter, number formatting, a totals row) — never a renamed CSV. Large reports can generate in the background.
- **Family self-service** — families can download their own volunteer-hour summary, and report a missing/incorrect record directly from their dashboard.
- **Notifications** (off by default) — deadline reminders, assessment-posted notices, and buyout rate-change alerts, with admin preview/test-send available regardless of whether automated sending is on.
- **Full audit history** for every action this feature takes.

## What's explicitly NOT included in this release

- **Native mobile support.** The Unestra mobile app does not gain any new screens in this release — see `docs/pta-volunteer-hours-mobile-phase3-spec.md` for what's planned for a later, separate program. Families use the existing responsive web portal on mobile browsers in the meantime.
- Scheduled/recurring automatic report generation (background generation is on-demand only, not on a schedule).
- A general-purpose membership contract-signing/registration system — the buyout election lives on the family dashboard instead.

## Organization-level configuration

Every part of this feature is **off by default** and opt-in. An ORG_OWNER/ORG_ADMIN turns it on per-organization via six independent toggles (**PTA → Settings → Volunteer Requirements & Buyout**) — requirements, buyout, assessments, reports, notifications, and a reserved native-mobile toggle with no effect yet. See `docs/pta-volunteer-hours-admin-guide.md` for the full setup guide.

## Backward compatibility

No existing organization is affected by this deploy. No existing API contract changed — every new endpoint is additive, under a new `/api/labs/pta/volunteer-hours/*` namespace. The existing mobile app's endpoints (`/api/mobile/pta/*`) were not touched at all, verified by a permanent automated regression test. Every database change is additive (new tables, new columns with safe defaults) — nothing existing was dropped, renamed, retyped, or made required.

## Permissions

11 new fine-grained permissions, split so hours-tracking authority (STAFF) and money authority (FINANCE) stay separate — see `docs/pta-volunteer-hours-api-reference.md` for the full matrix.

## Documentation

- `docs/pta-volunteer-hours.md` — full engineering history, stage by stage (VH-A through VH-L)
- `docs/pta-volunteer-hours-admin-guide.md` — officer/admin setup and usage guide
- `docs/pta-volunteer-hours-family-guide.md` — family-facing guide
- `docs/pta-volunteer-hours-api-reference.md` — API, database, and permission reference
- `docs/pta-volunteer-hours-mobile-phase3-spec.md` — Phase 3 native mobile specification (document only)
- `docs/pta-volunteer-hours-rollout-runbook.md` — dark-launch and rollback procedure
