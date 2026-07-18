# Plan entitlements

Single source of truth for what a subscription plan includes, and how that gets enforced on the backend, shown in the UI, and eventually extended for Unestra Labs.

## Source of truth

`src/lib/plans.ts` — `PLANS: Record<PlanId, PlanConfig>` (`free` / `essential` / `elite`). Each plan's `limits` object holds:

- `members: number` — a usage ceiling (`Infinity` = unlimited). Enforced via `checkMemberLimit()` / `requireMemberSlot()`.
- Boolean feature flags — `emailCampaigns`, `pdfExport`, `advancedReports`, `apiAccess`. Enforced via `requirePlanFeature()`.

`FeatureKey` (`src/lib/plans.ts`) is `Exclude<keyof PlanLimits, "members">` — every boolean flag on `PlanLimits`, derived rather than hand-listed. Adding a new Labs flag to `PlanLimits` automatically makes it a valid `requirePlanFeature()` argument.

Plan IDs, names, prices, and Stripe price-env-key references are unchanged by the entitlement-enforcement work described here — see the "Deferred" section below.

## `src/lib/plan-gate.ts`

- `getOrgPlan(organizationId)` — resolves the effective plan: billing-exempt orgs always get `elite`; a free-plan org inside an active trial window gets `essential`; otherwise the org's stored `plan` column.
- `isBillingExempt(organizationId)` — true only for orgs with `Organization.billingExempt = true` (today: APH Technologies, LLC, the platform-owning org). Never derived from `PlatformAccess`, session role, or org name/type — see the migration that sets this column for why.
- `getTrialStatus(organizationId)` — trial window state; always `isInTrial: false` for billing-exempt orgs.
- `checkMemberLimit` / `requireMemberSlot` — usage-count gate for the `members` limit.
- `checkSeatLimit` / `requireSeatSlot` — usage-count gate for staff "portal user seats" (excludes the constituent-facing `MEMBER` role).
- `requirePlanFeature(organizationId, feature: FeatureKey)` — **the authoritative backend gate for boolean features.** Throws `PlanFeatureError` when the resolved plan doesn't include `feature`. Call this at the narrowest point that actually performs the gated action (a send, an export, a key issuance) — never rely on UI hiding alone.
- `getOrganizationEntitlements(organizationId)` — one consolidated read-only snapshot (plan, billing exemption, trial, members, seats, feature flags) for UI/display consumption. Composes the functions above; does not itself enforce anything.

### Error contract

`requirePlanFeature` throws `PlanFeatureError` (`status: 403`, `code: "PLAN_FEATURE_REQUIRED"`, `feature: FeatureKey`). `requireMemberSlot`/`requireSeatSlot` throw the sibling `PlanLimitError` (`status: 403`, `code: "PLAN_LIMIT"`) — a usage-count denial ("you're out of room") is a different failure mode from a feature denial ("your plan doesn't include this at all"), so they're distinct classes with distinct codes.

Both are caught centrally in `withApiErrorHandling` (`src/lib/api-route.ts`) and serialized as:

```json
{ "ok": false, "error": "This feature is not included in your Free plan. Upgrade to access it.", "code": "PLAN_FEATURE_REQUIRED", "feature": "advancedReports" }
```

Any route calling `requirePlanFeature`/`requireMemberSlot`/`requireSeatSlot` must be wrapped in `withApiErrorHandling` (not the narrower `withForbiddenHandler`, which only understands `ForbiddenError`) or the thrown error will surface as an unhandled 500 instead of this contract.

## What's enforced today

| Feature | Enforced at | Notes |
|---|---|---|
| `emailCampaigns` | `POST /api/communications/campaigns` (creation, EMAIL/EMAIL_AND_SMS channel only) and inside `sendCommunicationCampaign()` (every send path: the "Send Now" checkbox, the manual send button, and the cron/worker) | SMS remains its own separate add-on gate (`getSmsEntitlement`) — unrelated to this flag. `INTERNAL_LOG_ONLY` campaigns are never gated. |
| `pdfExport` | `GET /api/reports/export` (`format=pdf`), `POST /api/reports/send` (`includeAttachment && format==="pdf"`), `GET /api/members/export` (`format=pdf`) | CSV/XLSX are not flag-gated on any plan — only the PDF output format is a paid feature. Contribution receipts (`generateAndStoreReceiptPdf`) are never gated — they're a legal record, not a "report." |
| `advancedReports` | **Not enforced — see below.** | |
| `apiAccess` | **Not enforced — see below.** | |

### Why `advancedReports` and `apiAccess` aren't enforced yet

- **`advancedReports`**: the Report Center (`/reports`, `buildReport()`) has no existing distinction between "basic" and "advanced" report types — every report type (financial, membership, attendance, delivery, etc.) is gated only by role (`reports:read`/`reports:export`, plus a `financialRoles` check for money-related types), identically across every plan. Inventing a basic/advanced split now, with no product definition to base it on, would mean guessing which of ~25 report types to take away from paying Essential customers — a commercial redesign, not a bug fix. Flagged per this task's stop conditions rather than guessed at.
- **`apiAccess`**: there is no external, customer-facing API-key system in this codebase at all (no `ApiKey` model, no `/api/v1/*` surface). The only "API key" concept that exists (`session.api_key` / `authOptions.ts`'s "Organization API Key" credentials provider) is a legacy first-party authentication path predating the SaaS rewrite, not a paid third-party integration feature. There is nothing to gate.

Both flags keep working through `getOrganizationEntitlements()` for **display only** (pricing page, billing page) — they are informational until a real capability exists behind them. `requirePlanFeature(orgId, "advancedReports" | "apiAccess")` is fully wired and type-checked; call it the moment either capability is actually built.

## Billing-exempt and trial behavior

`getOrgPlan()`/`isBillingExempt()` are the single resolution point every other check in this file goes through, so behavior is automatically consistent:

- **Billing-exempt** (APH Technologies): resolves to `elite` — every feature flag is `true`, `members`/`seats` limits are `elite`'s. Never depends on `PlatformAccess` or session role.
- **Active trial** (free-plan org, `trialEndsAt` in the future): resolves to `essential` — `emailCampaigns`/`pdfExport` are included, `advancedReports`/`apiAccess` are not (those are elite-only, and a trial only elevates to Essential).
- **No subscription / expired trial**: resolves to the org's stored `plan` (defaults to `free` if unset) — no boolean features included.
- **Malformed/missing organization row**: every check defaults to the safe (denying) branch rather than throwing.

## UI behavior

`getOrganizationEntitlements()` drives the same decision the backend enforces:

- `communications/new` — disables the Email/Email+SMS channel options (native `disabled` `<option>`s, matching the existing SMS add-on pattern) with an inline upgrade hint linking to Billing Settings when `!features.emailCampaigns`.
- `reports` — disables the "Export PDF" button and the PDF option in the email-attachment format select when `!features.pdfExport`, with the same inline hint.
- `members` — replaces the "Export PDF" link with a disabled, `aria-label`led placeholder when `!features.pdfExport`.

None of this is the actual enforcement boundary — every one of these actions still goes through the real backend check regardless of what the UI shows, so a direct API call cannot bypass it.

## Tenant isolation

Every `requirePlanFeature`/`requireMemberSlot`/`requireSeatSlot` call site takes `organizationId` from `requirePermission(...)` (session-resolved), never from a client-supplied parameter — consistent with every other authorization check in this codebase. `PlatformAccess` (global platform authorization) is a completely separate axis from tenant billing/entitlement state; a platform operator opening another organization's admin view never grants that organization — or themselves — any feature access.

## Background jobs / concurrency

`sendCommunicationCampaign()` re-checks `emailCampaigns` fresh on **every** call — not just at campaign-creation time — because it's the single function behind three different triggers (immediate "Send Now", the manual send button, and the `processScheduledCampaigns` cron worker). If an org is downgraded after scheduling an EMAIL campaign but before it sends, the next attempt (by any of the three triggers) throws `PlanFeatureError`, immediately marks the campaign `FAILED` (with an audit event), and does not touch any recipient. This prevents the cron worker from silently re-attempting — and failing on — the same blocked campaign every tick forever.

## Adding a new paid feature (including future Unestra Labs keys)

1. Add the field to `PlanLimits` in `src/lib/plans.ts` (boolean) — `FeatureKey` picks it up automatically.
2. Set its value for each plan in `PLANS`.
3. Call `await requirePlanFeature(organizationId, "yourFeature")` at the narrowest point that performs the gated action — the actual mutation/send/export, not just the route handler's entry or a UI check.
4. If the feature can be triggered asynchronously (a worker, a cron tick, a retry), re-check there too — don't assume the creation-time check is still valid by the time the job runs.
5. Add the same boolean to any UI that needs to show availability, sourced from `getOrganizationEntitlements()` — never re-derive plan logic in a component.
6. Add an audit event when access is denied for a job that was already scheduled/in-flight (see `sendCommunicationCampaign`'s pattern).
7. Add tests: entitled/denied/trial/billing-exempt/cross-tenant, plus the standardized error shape.
8. Update this document.
9. Do not add Stripe pricing, plan renames, or new plan tiers without separate, explicit billing approval — that's a commercial decision, not an engineering one.

## Deferred (explicitly out of scope for this document's associated PR)

- Renaming `free`/`essential`/`elite` to Starter/Professional/Enterprise, or changing their numeric limits — these plan IDs are live in Stripe price-env-key wiring and webhook plan resolution; renaming is a billing-facing change requiring separate sign-off.
- `advancedReports`/`apiAccess` real enforcement (see above) — needs a product decision on what "advanced" means and/or a real customer-facing API-key system to exist first.
- Unestra Labs features (`meetingIntelligence`, `aiAnnouncements`, `policyAssistant`, `executiveCopilot`, `workflowAutomation`) — not built, not priced, not exposed anywhere. The `FeatureKey` typing is ready for them the moment a real capability and plan decision exist.
