# Unestra for PTA — Volunteer Hour Requirements, Buyouts & Reporting: API, Database & Permission Reference

Companion to `docs/pta-volunteer-hours.md` (the stage-by-stage engineering history). This is the flat reference: every new database model, every new API route, every new permission, and the feature flags that gate all of it.

## Feature flags

**Platform kill-switch** (env var, Unestra-staff-only): `PTA_VOLUNTEER_HOURS_PLATFORM_ENABLED` — `src/lib/env.ts`, checked first by `requireVolunteerHoursFlag()` before any org-level flag is even read.

**Org-level flags** — six independent `Boolean @default(false)` columns on `PtaProfile`:

| Column | Gates |
|---|---|
| `ptaVolunteerRequirementsEnabled` | Periods, assignments, the family dashboard card. Every other flag below additionally requires this one — structurally, buyout/assessments/reports/notifications can't exist without a requirement period to attach to. |
| `ptaVolunteerBuyoutEnabled` | Pricing windows, election, checkout, offline payment recording |
| `ptaVolunteerAssessmentsEnabled` | Assessment preview/review/post |
| `ptaVolunteerReportsEnabled` | The Reporting Center (all 7 reports + background export) |
| `ptaVolunteerNotificationsEnabled` | Automated notification sends only — preview/test-send bypasses this deliberately |
| `ptaVolunteerNativeMobileEnabled` | Reserved for Phase 3 — unread by any code shipped in this program |

Server-side enforcement: `requireVolunteerHoursFlag(organizationId, capability)` in `src/lib/labs/pta/volunteer-hours/guard.ts`, composed into `requireVolunteerHoursAccess()` (officer/RBAC routes) and `requireVolunteerHoursHouseholdAccess()` (family self-service routes, linkage-based like the rest of the PTA vertical). No route in this program checks a flag only in the UI.

## Permissions (`src/lib/rbac.ts`)

| Constant | String | Notes |
|---|---|---|
| `PTA_VOLUNTEER_REQUIREMENTS_VIEW` | `pta:volunteer-requirements:view` | |
| `PTA_VOLUNTEER_REQUIREMENTS_MANAGE` | `pta:volunteer-requirements:manage` | Periods, assignments, notification triggers/preview |
| `PTA_VOLUNTEER_REQUIREMENTS_ADJUST_FAMILY` | `pta:volunteer-requirements:adjust-family` | |
| `PTA_VOLUNTEER_BUYOUT_PRICING_MANAGE` | `pta:volunteer-buyout-pricing:manage` | |
| `PTA_VOLUNTEER_REPORTS_VIEW` | `pta:volunteer-reports:view` | Reports A-D, F, G — on-screen |
| `PTA_VOLUNTEER_REPORTS_EXPORT` | `pta:volunteer-reports:export` | Reports A-D, F, G — Excel + background queue |
| `PTA_VOLUNTEER_FINANCIAL_REPORTS_VIEW` | `pta:volunteer-financial-reports:view` | Report E only — view AND export, no separate export permission exists |
| `PTA_VOLUNTEER_ASSESSMENTS_PREVIEW_POST` | `pta:volunteer-assessments:preview-post` | |
| `PTA_VOLUNTEER_PAYMENTS_RECORD_OFFLINE` | `pta:volunteer-payments:record-offline` | |
| `PTA_VOLUNTEER_PAYMENTS_REFUND` | `pta:volunteer-payments:refund` | |
| `PTA_VOLUNTEER_AUDIT_VIEW` | `pta:volunteer-audit:view` | |

Role bundling: ORG_OWNER/ORG_ADMIN/SUPER_ADMIN get all 11. FINANCE gets pricing, financial reports, general reports, offline payments/refunds, audit — not requirements-manage or assessments. STAFF gets requirements (all 3), general reports, assessments — not pricing, financial reports, or payments. READ_ONLY gets requirements:view + reports:view only. MEMBER gets none (household self-service is linkage-based, not a role grant). Full matrix tested in `src/lib/__tests__/rbac-volunteer-hours.test.ts`.

## Database models (all additive — nothing existing was dropped, renamed, or narrowed)

| Model | Added in | Purpose |
|---|---|---|
| `PtaVolunteerRequirementPeriod` | VH-A | A school year/term/contract period: default hours, deadline, buyout/assessment windows, status (Draft/Active/Closed/Archived) |
| `PtaVolunteerRequirementAssignment` | VH-B | Per-scope or per-household override of the period default (exempt, reduced, per-child, waiver, etc.) |
| `PtaVolunteerPricingWindow` | VH-C | Time-boxed buyout/assessment rate, never overlapping another active window of the same rate type |
| `PtaVolunteerLedgerEntry` | VH-D | The unified hours+money obligation ledger — complements (doesn't replace) the pre-existing `PtaVolunteerHourEntry`/`PtaVolunteerHourAdjustment` pair |
| `PtaVolunteerBuyoutElection` | VH-E | A family's stated choice (volunteer/full buyout/partial buyout) — election ≠ payment |
| `PtaVolunteerHourDispute` | VH-E | A family-reported "this hour record is missing/wrong," admin-reviewed |
| `PtaVolunteerBuyoutPurchase` | VH-F | A completed/pending/refunded buyout transaction, full rate/hours snapshot |
| `PtaVolunteerAssessmentBatch` / `PtaVolunteerAssessmentLine` / `PtaVolunteerAssessmentCharge` | VH-G | Draft-preview → review → post pipeline; one charge per included family, duplicate-post-proof |
| `PtaVolunteerReviewFlag` | VH-H | Human-review flags for corrections-after-posting and overpayment-after-reduction — never auto-charge/auto-refund |
| `PtaVolunteerNotificationLog` | VH-L | Dedup log for every automated notification sent, unique on `(org, notificationType, householdId, sourceId)` |

Pre-existing models this program reuses unmodified: `PtaVolunteerRequirement` (legacy flat requirement, stays authoritative for any org that never enables this feature), `PtaVolunteerHourEntry`/`PtaVolunteerHourAdjustment`/`PtaVolunteerOpportunity`/`PtaVolunteerSlot`/`PtaVolunteerSignup`/`PtaVolunteerAttendance` (from the original PTA Vertical 2.0 program).

## API routes

All under `/api/labs/pta/volunteer-hours/`, except the cron sweep.

**Officer/admin — period setup:**
`GET/POST periods`, `GET/PATCH periods/[periodId]`, `GET periods/[periodId]/preview`, `GET/POST periods/[periodId]/assignments`, `PATCH/DELETE periods/[periodId]/assignments/[assignmentId]`, `GET/POST periods/[periodId]/pricing-windows`, `PATCH/DELETE periods/[periodId]/pricing-windows/[windowId]`.

**Buyout/payments:** `POST periods/[periodId]/purchases/offline`, `POST periods/[periodId]/purchases/[purchaseId]/refund`, `POST periods/[periodId]/hour-entries/[entryId]/reverse`, `GET periods/[periodId]/check-overpayment`.

**Assessments:** `GET/POST periods/[periodId]/assessments`, `GET periods/[periodId]/assessments/[batchId]`, `PATCH periods/[periodId]/assessments/[batchId]/lines/[lineId]`, `POST periods/[periodId]/assessments/[batchId]/post`, `POST periods/[periodId]/assessments/[batchId]/cancel`, `POST periods/[periodId]/assessments/charges/[chargeId]/offline`.

**Disputes & review:** `GET/POST periods/[periodId]/disputes`, `PATCH periods/[periodId]/disputes/[disputeId]`, `GET periods/[periodId]/review-flags`, `POST periods/[periodId]/review-flags/[flagId]/resolve`.

**Reports (JSON + `.xlsx` export pair each):** `periods/[periodId]/reports/{family-summary,detail-activity,event-hours,compliance,financial,individual-volunteer,volunteer-category}` and each `.../export`.

**Background report export:** `POST/GET periods/[periodId]/reports/exports` (queue + list, permission-filtered per report type), `GET periods/[periodId]/reports/exports/[exportId]/download` (own dedicated signed-URL route — deliberately not the platform's generic `/api/attachments/[id]/download`, which is gated on the coarser `reports:read`).

**Notifications:** `POST periods/[periodId]/notifications/deadline-reminders`, `POST periods/[periodId]/notifications/rate-change-notices`, `POST periods/[periodId]/notifications/preview`.

**Audit:** `GET audit` (org-wide, filtered to this feature's `pta.volunteer_hours.*` audit actions).

**Family self-service** (all under `my-household/`, household resolved server-side from the caller's session, never a client-supplied ID): `GET my-household/summary`, `GET/POST my-household/quote`, `POST my-household/election`, `POST my-household/checkout`, `GET/POST my-household/disputes`, `GET my-household/assessments`, `POST my-household/assessments/[chargeId]/checkout`, `GET my-household/report`, `GET my-household/report/export`.

**Cron:** `POST /api/cron/volunteer-hours-notifications` (bearer `CRON_SECRET`, same pattern as every other `/api/cron/*` route; not registered with any external scheduler as part of this program — see the rollout runbook).

## What was never touched

Every existing `/api/mobile/pta/*` route (`profile`, `volunteers/*`, `announcements/*`, `events/*`, `dues/*`, `documents`, `meetings/*`) — enforced by a static-source regression test, `src/lib/labs/pta/volunteer-hours/__tests__/mobile-compatibility.test.ts`. The generic cross-vertical `ReportExport`/`processQueuedReportExport` worker in `src/lib/reports.ts` had one small, additive branch inserted (real-`.xlsx` volunteer-hours jobs, routed before the existing CSV path) — its existing CSV behavior for every other report type is unchanged.
