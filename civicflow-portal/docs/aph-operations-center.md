# APH Operations Center

**User-facing name:** APH Operations Center (subtitle: *Unestra Platform Operations*)
**Route:** `/admin/platform`
**Status as of this phase:** read-only, with exactly one narrowly-scoped action (switching the platform admin's own active organization, when they already hold a real membership there — no new write path was added).

## Purpose

Gives an APH Technologies platform administrator (a `PlatformAccess` `SUPER_ADMIN` grant — see [platform-identity-architecture.md](./platform-identity-architecture.md)) visibility into Unestra as a commercial multi-tenant SaaS platform: organization health, billing state, communications volume/failures, system health, background-job health, and platform audit activity — without weakening tenant isolation or granting access to individual customers' business records (member lists, dues, contributions, etc.).

This is Phase 1. It replaces the previous minimal `/admin/platform` page (which fetched up to 50 unpaginated organizations/subscriptions/audit events with no filtering) with a real, paginated, multi-section console. It is explicitly **not** a multi-product control plane — the architecture (a dedicated `lib/platform-operations/` data layer, `PlatformAccess`-gated routes under one root) doesn't block adding a future product (e.g. UnionFlow) alongside Unestra, but no such support is built in this phase.

## Architecture

```
src/app/admin/platform/
├── layout.tsx                     — shared shell: auth gate, platform-role/active-org header, nav, env indicator
├── page.tsx                       — Overview
├── organizations/
│   ├── page.tsx                   — Organizations directory
│   └── [organizationId]/page.tsx  — Organization operational detail
├── people/page.tsx                — Global people directory
├── billing/page.tsx                — Billing operations
├── communications/page.tsx         — Communications operations
├── health/page.tsx                 — System health
├── jobs/page.tsx                   — Background operations
├── audit/page.tsx                  — Platform audit
└── sms/**                          — Pre-existing SMS Administration module (credentials, per-org limits) — linked from Communications, not replaced

src/lib/platform-operations/        — server-only data layer (import "server-only" enforced)
├── types.ts        — Metric<T>, PagedResult<T>, pagination helpers, DataSource/Freshness/RiskSeverity/ServiceStatus
├── redaction.ts     — deny-list secret redaction for audit metadata
├── overview.ts       — Overview page aggregation
├── organizations.ts   — directory + detail queries, deriveOrganizationHealth()
├── people.ts           — directory queries, duplicate-email detection
├── billing.ts            — subscription queries, MRR estimate, Stripe-linkage checks
├── communications.ts      — SMS/email/push aggregation
├── health.ts                — live + inferred service checks
├── jobs.ts                    — job-type health derived from each job's own output table
├── audit.ts                     — filtered/paginated AuditEvent reads, redaction applied
└── risks.ts                       — deterministic operational-risk rules

src/components/admin/
├── OperationsUI.tsx               — StatusPill, MetricValue, Breadcrumbs, Pagination, EmptyState
├── OperationsCenterNav.tsx        — client nav (active-route highlighting)
├── CopyIdButton.tsx               — client copy-to-clipboard for organization IDs
└── OpenInOrganizationPortalButton.tsx — client button wrapping the existing /api/organization/select endpoint
```

## Route map

| Route | Purpose |
|---|---|
| `/admin/platform` | Overview: summary cards, risk feed, recent activity |
| `/admin/platform/organizations` | Searchable, filterable, paginated organization directory |
| `/admin/platform/organizations/[organizationId]` | Platform-operations view of one organization |
| `/admin/platform/people` | Global, cross-org user directory |
| `/admin/platform/billing` | Subscription status, MRR estimate, Stripe-linkage problems |
| `/admin/platform/communications` | SMS/email/push volume, failures, opt-outs |
| `/admin/platform/health` | Live/inferred status of every real external dependency |
| `/admin/platform/jobs` | Background-job health, derived from each job's own output table |
| `/admin/platform/audit` | Filtered platform audit log with redaction |
| `/admin/platform/sms/*` | Pre-existing SMS Administration (credentials, per-org limits) — unchanged |

## Data sources and freshness

Every non-trivial value in the data layer is typed as `Metric<T>`:

```ts
type Metric<T> =
  | { status: "ok"; value: T; source: DataSource; asOf: string }
  | { status: "unavailable"; reason: string; source: DataSource }
  | { status: "not_configured"; reason: string };
```

The UI (`MetricValue` component) renders `"Unavailable"` or `"Not configured"` text for the latter two states — **never a fabricated `0`**. `DataSource` is one of `database | stripe | twilio | brevo | expo | health-check | derived`. `Freshness` (used on `ServiceHealth`) is one of `live | cached | inferred | unavailable` — `inferred` means "we checked that credentials/config exist," not "we actually reached the provider."

## Authorization

Every page and the shared layout call `requireSuperAdmin()` (`src/lib/auth-guards.ts`), which resolves the global `PlatformAccess` grant — entirely independent of the caller's active organization, `cf_active_org` cookie, or any `OrganizationMembership` row. No Operations Center code path uses `requireRole("SUPER_ADMIN")`, checks `session.role`, or otherwise substitutes tenant/org authorization for platform authorization. A source-level regression test (`platform-operations-authorization-wiring.test.ts`) fails the build if any current or future page under `/admin/platform` stops calling `requireSuperAdmin()` or starts using one of those legacy patterns.

## Tenant-boundary rules

- The data layer never queries tenant business-data models (`OrgMember` records, `DuesCharge`, `Contribution`, `CommunicationLog` message bodies, etc.) for display — only platform-metadata models (`Organization`, `OrganizationMembership` counts/roles, `Subscription`, `OrganizationSmsSettings`, `AuditEvent`, aggregate counts against `SmsMessage`/`EmailReminderLog`/`MobileDeviceToken`).
- The organization detail page is a **platform-operations view, not an impersonated tenant view** — it shows counts, statuses, and role distributions, never individual member names/contact info/financial records.
- "Open in organization portal" only appears, and only works, for an organization the signed-in platform admin already has a **real, active membership** in — re-verified server-side by the pre-existing `/api/organization/select` endpoint regardless of what the button believes client-side.
- Guessing an organization ID exposes only the same platform-metadata every other organization's detail page exposes — never a different class of data.

## Available metrics (real, DB-derived)

Organizations (total/active/trial/suspended/new-30d), people (total/active memberships/pending invitations/multi-org/new-30d), billing (status counts, plan distribution, trials-ending-soon, missing-Stripe-linkage, estimated MRR), SMS (sent/delivered/failed/opt-outs/usage-by-org, from `SmsMessage`), reminder email (sent/failed/by-org, from `EmailReminderLog`), push (registered tokens, sent volume, from `MobileDeviceToken`/`CommunicationLog`), platform audit events (filtered, paginated, redacted).

## Unavailable metrics (honestly labeled, not fabricated)

- **Last sign-in** — no such field exists anywhere in the schema. Always rendered "Not tracked."
- **Individual Stripe invoice failures** — only subscription `status` is synced locally (via the Stripe webhook); no per-invoice event log exists. "Past due" subscriptions are the closest proxy, not the same thing.
- **All-email volume** — `EmailReminderLog` only covers dues/contribution/renewal reminder emails. Authentication emails (verification, password reset) use `sendEmail()` directly, which only produces structured console logs, never a DB row. The Communications page labels this scope explicitly.
- **Push delivery failures / invalid-token count** — Expo receipts aren't persisted; stale tokens are pruned silently on send.
- **SMS "missing consent" blocked-attempt count** — consent is enforced *before* an `SmsMessage` row is ever created, so a blocked attempt leaves no row to count.
- **Failed scheduled jobs / durable job-run history** — no job-run table exists (see Background Operations below).
- **SMS Usage Notifications job status** — sends via `sendEmail()` directly with no durable output table; always "unknown."

## Provider integrations

- **Stripe**: local `Subscription`/`Organization` rows are the primary source everywhere except the System Health page, which makes one live, timeout-bounded `balance.retrieve()` call. Billing/Overview pages link out to `dashboard.stripe.com/customers/<id>` for real invoice/payment detail — never re-implemented locally.
- **Twilio**: Communications/Billing/Overview never call Twilio directly — all figures come from `SmsMessage` (written by the existing send/webhook pipeline). System Health reports whether credentials are configured (`inferred`), not a live API probe.
- **Brevo (email)**: same pattern — `EmailReminderLog` is the source; System Health reports SMTP-credential presence only.
- **Expo push**: no credentials exist to check; System Health reports `unknown` with an explanatory message rather than fabricating a status.
- **License server** (desktop store checkout): System Health reports env-var presence only — no live call, since no health-endpoint contract is documented for it yet.

## Health status definitions

`healthy | degraded | unavailable | not_configured | unknown`, each carrying a `freshness` of `live` (a real request was made this page load), `cached` (derived from stored data, e.g. job failure counts), `inferred` (config presence stood in for a live probe), or `unavailable` (no signal exists at all). Every check has its own timeout (3s) and its own try/catch — one integration failing never breaks the page or any other check's result (`getSystemHealth()` never throws).

## Risk-rule definitions (`risks.ts`)

All deterministic, no AI/ML scoring:

| Rule | Severity | Trigger |
|---|---|---|
| Past-due subscription | critical | `Subscription.status = 'past_due'` |
| No active owner | warning | zero active `ORG_OWNER`/`SUPER_ADMIN` memberships on an active org |
| Trial ending soon | info | `Organization.trialEndsAt` within 14 days |
| Missing billing linkage | warning | paid-plan org with zero `Subscription` rows |
| High SMS usage | warning | `smsUsedThisPeriod / smsMonthlyLimit >= 0.9` |
| SMS failure-rate spike | critical | ≥10 sends and ≥20% failed in the last 24h |
| Repeated job failures | critical/warning | any job type's 7-day failure count ≥5 (critical) or >0 (warning) |
| Platform admin without MFA | warning | active `PlatformAccess` holder with `User.mfaEnabled = false` |
| Orphaned users | info | zero active memberships and zero platform access |
| Stale pending invitations | info | `MemberInvite` unaccepted, unexpired, older than 7 days |

Deliberately **not** implemented: "multiple owners" (not risky by any defined policy in this codebase) and live-provider-outage-as-risk (would make every Overview load pay for a Stripe round trip; provider status belongs on the System Health page instead).

## Audit redaction

`redactSensitiveFields()` deep-walks `AuditEvent.before`/`after` (arbitrary `Json`) and replaces any value whose **key name** matches a deny-list pattern (`password`, `secret`, `token`, `apikey`, `credential`, `cookie`, `session`, `signature`, `*webhooksecret*`, `*clientsecret*`, `*accesstoken*`, `*refreshtoken*`, case-insensitive, underscores optional) with `"[redacted]"`. Deny-list rather than allow-list because audit payload shapes vary across ~15+ action types and a fixed allow-list would silently miss a newly-added sensitive field. Recursion is capped at depth 10. Fully unit-tested (`redaction.test.ts`).

## Performance limits

- Every list endpoint is paginated (default 25, max 100 per page, enforced server-side by `normalizePagination()` regardless of what a query string claims).
- All counts/aggregations use Prisma `count`/`groupBy` — never "fetch everything and count in JS," except two explicitly bounded, documented exceptions: `findDuplicateLookingAccounts()` (≤5000 users) and the `onlyMultiOrg` people-filter path (≤2000 candidates) — both an order of magnitude above realistic scale for this stage, and both flagged in code comments as loose ends if the user base grows.
- Default reporting window is 30 days (Overview/Communications); Health/Jobs checks have their own independent, short (3s) timeouts.
- The Health page is the only page making a live external call (Stripe); every other page is 100% local-database reads.

## Known limitations

- No durable job-run table exists — Background Operations infers status from each job's own output table (`SmsMessage`, `EmailReminderLog`, `ReportExport`, `CommunicationCampaign`). One job type (SMS Usage Notifications) has no output table at all and is always reported "unknown." No retry actions are exposed, since no job type currently supports a safe, idempotent retry entry point.
- Estimated MRR uses the hardcoded `PLANS` price table (`src/lib/plans.ts`), not a live Stripe price fetch — it will drift if Stripe prices are changed without updating that file. It excludes seat add-ons, the SMS add-on, discounts, and proration, and only counts `active` (not `trialing`) subscriptions.
- A person detail page was not built separately — the People directory uses an expandable `<details>` row instead, per the task's own "or a controlled details drawer" allowance.
- No React Server Component render tests exist for these pages, consistent with this repo's existing test suite (100% API-route/lib-level, zero component tests anywhere). Authorization is instead proven by (a) the pre-existing, comprehensive `requireSuperAdmin`/tenant-isolation test suite, which every page reuses unchanged, and (b) a source-level regression guard confirming every page actually calls it.
- `Object.freeze`-style immutability isn't enforced on audit rows at the database layer — the "audit logs must not become editable" requirement is satisfied by this phase adding zero write/update paths to `AuditEvent`, not by a DB constraint.

## Future phases (not implemented)

Safe support-access workflow, audited tenant impersonation, organization suspension, feature flags, product-level access scopes, UnionFlow operations, Labs model usage, AI cost monitoring, cross-product identity, automated incident alerts, richer revenue analytics (real Stripe-synced MRR/ARR), provider webhook monitoring, a dedicated job-run model with retry support, a person detail page, live Twilio/Brevo/Expo health probes.
