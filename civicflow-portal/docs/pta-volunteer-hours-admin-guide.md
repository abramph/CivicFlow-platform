# Unestra for PTA — Volunteer Hour Requirements, Buyouts & Reporting: Administrator Guide

This is the officer/admin-facing guide to the Volunteer Hour Requirements, Buyouts & Reporting feature (VH-A through VH-L, see `docs/pta-volunteer-hours.md` for the full engineering history). It is an **optional, opt-in feature**, off for every organization until an ORG_OWNER/ORG_ADMIN with `pta:volunteer-requirements:manage` explicitly turns it on. Nothing about how PTA volunteer sign-ups, attendance, or hour approval already works (`docs/pta-volunteer-management.md`) changes when this feature is off.

## 1. Turning it on

Go to **PTA → Settings → Volunteer Requirements & Buyout**. You'll see six independent toggles:

| Toggle | Unlocks |
|---|---|
| Volunteer requirements | Requirement periods, per-family assignment rules, the family dashboard card |
| Buyout | Pricing windows, the family's buyout election, checkout, offline payment recording |
| Assessments | Preview/review/post remaining-hours charges |
| Reports | The Reporting Center (Reports A-D and F-G) |
| Notifications | Automated deadline/assessment/rate-change emails to real families |
| Native mobile | Reserved for a future phase — has no effect yet (Phase 1 is web-only) |

Every toggle is independent — turning on Reports never turns on Buyout, turning on Buyout never authorizes Assessments, etc. If your organization's plan/environment doesn't have this feature provisioned at the platform level, none of these toggles will do anything (there's also a platform-wide kill-switch, `PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED`, which only Unestra staff control).

Turning on **Volunteer requirements** alone is enough to see empty period-setup screens — it doesn't require any money or buyout code to be enabled at all. Many PTAs will only ever turn on Requirements + Reports and never touch Buyout/Assessments if they just want to track hours and report on them.

## 2. Setting up a requirement period

**PTA → Settings → Volunteer Requirements & Buyout → Volunteer requirement periods → New period.**

A period needs: a name (e.g. "2026-2027 School Year"), start/end dates, a default required-hours amount per family, and (optional) a volunteer-completion deadline. Only one period can be `ACTIVE` at a time per scope label — if you run separate concurrent programs (e.g. separate elementary/middle campuses), give them different scope labels so they don't conflict.

A period starts as `DRAFT`. Nothing is visible to families and no requirement applies until you flip it to `ACTIVE`.

### Adjusting the requirement per family

Open the period → **Assignment rules & preview**. By default every family gets the period's flat default. You can override per scope (grade, classroom, membership plan) or per individual household: reduce the hours, mark a family exempt (temporarily or for the whole year), or apply a per-child/per-adult multiplier. Every non-standard assignment requires a written reason, and the full per-family table previews exactly what each household will owe **before** you activate the period.

## 3. Setting buyout pricing (optional)

Requires the **Buyout** toggle. Open the period → **Pricing windows**. A window has a rate type (full buyout, per-hour, or the final-assessment rate), a dollar amount, and a start/end date-time. Two active windows of the *same* rate type can never overlap — the system rejects it outright rather than silently averaging two rates.

The price a family is quoted is always resolved server-side at the moment they request a quote or start checkout — nothing about pricing is ever trusted from the browser.

## 4. Recording an offline payment

Requires **Buyout** + `pta:volunteer-payments:record-offline`. On the period page, **Record an offline buyout payment** lets you log cash/check/Zelle/Cash App payments. Hours are credited immediately on save — this action *is* the verification step, so only record it once you've actually received the payment.

## 5. Remaining-hours assessment

Requires **Assessments** + `pta:volunteer-assessments:preview-post`. On the period page, **Remaining-hours assessment**:

1. **Preview** — computes, for every family with hours still outstanding, exactly what they'd be charged at the current final-assessment rate. This creates a `DRAFT` batch but **zero real obligations** — nothing is charged yet.
2. **Review** — exclude any family from the batch (a reason is required), or adjust the batch and re-preview.
3. **Post** — creates one real charge per included family, atomically and duplicate-proof (you cannot accidentally post the same batch twice). If notifications are on, each affected family gets an email; if a correction is needed later, you create a new supplemental/correction batch — a posted charge is never silently edited.

## 6. Corrections and refunds

If an hour entry gets corrected or reversed **after** an assessment already posted for that family, or a family's requirement gets reduced after they already paid/volunteered more than the new amount requires, the system does **not** auto-charge or auto-refund. It creates a **review flag** (visible on the period page under "Flagged for review") for a human to look at and decide what's fair.

## 7. The Reporting Center

Requires **Reports**. Open a period → **Reports**. Seven report types:

| Report | Gate | Contents |
|---|---|---|
| A — Family Volunteer Summary | `pta:volunteer-reports:view/export` | One row per family: hours, requirement status, dollars |
| B — Detailed Family Volunteer Activity | same | One row per raw hour entry |
| C — Event Volunteer-Hours | same | One row per event, aggregated |
| D — Volunteer Requirement Compliance | same | Deadline countdown + live (never posted) assessment estimate |
| E — Purchased-Hours & Financial | **`pta:volunteer-financial-reports:view`** (stricter — money-sensitive) | Every buyout purchase and assessment charge, reconciled |
| F — Individual Volunteer | `pta:volunteer-reports:view/export` | One row per person, for recognition |
| G — Volunteer Category | same | Hours by category, org-wide |

Every report shows the same numbers on screen and in its downloaded `.xlsx` — they're computed by the exact same server function, so they cannot diverge. The workbook always has three sheets: Report Information (who/when/filters), Summary, and Detailed Data (with a bold totals row and an autofilter).

**Large orgs / background generation**: instead of "Export to Excel" (synchronous), use **Generate in background**. It queues the export and you can come back later to download it once it's ready — useful if a report is large enough that generating it live would be slow. Report E's background jobs are only visible to people who can view Report E; a STAFF officer can queue Reports A-D/F/G in the background but not E.

## 8. Notifications

Requires **Notifications** for real, automated sends — **off by default**. Even while off, the **Preview / test-send** panel (on each period's page) lets you send a real test email to any address you choose, clearly marked `[TEST]`, so you can check wording before turning automated sending on. It never looks up a real family's email.

Once Notifications is on, three things can email a family:
- **Deadline reminder** — once per family per period, as the volunteer-completion deadline approaches.
- **Assessment posted** — once per posted charge, right after you post an assessment batch.
- **Rate change upcoming** — once per family per pricing window, as a new buyout rate is about to take effect.

Every send is deduplicated — running the sweep (or the "send now" button) twice never double-emails the same family for the same thing.

## 9. Audit history

`pta:volunteer-audit:view`. **PTA → Settings → View volunteer-hours audit history.** Shows every action this feature has recorded, most recent first — period/pricing changes, elections, purchases, assessment posts, corrections, report exports, notification sends.

## 10. Permissions at a glance

| Role | Requirements | Buyout pricing | Reports | Financial report | Assessments | Offline payments/refunds | Audit |
|---|---|---|---|---|---|---|---|
| ORG_OWNER / ORG_ADMIN | full | full | full | ✓ | ✓ | ✓ | ✓ |
| FINANCE | view only | ✓ | view/export | ✓ | — | ✓ | ✓ |
| STAFF | full | — | view/export | — | ✓ | — | — |
| READ_ONLY | view only | — | view only | — | — | — | — |
| MEMBER | — | — | — | — | — | — | — |

("Full" for requirements = view + manage + adjust-family.)

## 11. Rollback

Turning a flag off does not delete anything. All periods, ledger entries, purchases, charges, and audit history are preserved — they simply stop being reachable/actionable until the flag is turned back on. See `docs/pta-volunteer-hours-rollout-runbook.md` for the full dark-launch and rollback procedure.
