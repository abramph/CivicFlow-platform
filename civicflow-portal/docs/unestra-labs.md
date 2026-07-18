# Unestra Labs

A controlled framework for experimental, beta, AI-assisted, and premium product capabilities. This document covers the **framework** — registry, enrollment, entitlement, access resolution, Operations Center management, audit, usage metering, and privacy/security foundations. No Labs capability (Meeting Intelligence, AI Announcements, etc.) is implemented yet; every reserved key today is a registry placeholder only — internal-only, un-advertised, not enabled for any organization.

## Purpose

Unestra will ship AI-assisted and experimental capabilities over time (meeting transcription, AI-drafted announcements, policy Q&A, and more). Building authorization for each one from scratch would mean re-deriving the same questions repeatedly — does this org's plan cover it, has the org opted in, does this specific user have permission — and risks each feature getting a slightly different, inconsistent answer. Unestra Labs is that authorization work done once, correctly, ahead of any specific feature, so shipping a new Labs capability later is "register a key and gate three calls," not "design a new access-control system."

## The four-layer model

Every Labs feature check answers four independent questions, in this order:

```
1. Product capability exists         → the registry (src/lib/labs/registry.ts)
2. Organization entitlement permits it → plan/billing-exempt resolution (only if the feature requires it)
3. Labs enrollment/activation permits it → OrganizationLabFeature row (only if the feature requires it)
4. User has tenant permission           → ordinary RBAC (labs:read, or a feature-specific permission later)
    ↓
Feature action is allowed
```

These are never collapsed into one boolean. Concretely:

- **Exists** — is this a real, registered feature key? (`src/lib/labs/registry.ts`)
- **Entitled** — does the organization's plan (or billing-exempt status) qualify, if the feature requires an entitlement at all?
- **Enrolled/enabled** — has this specific organization been turned on for this feature, if the feature requires enrollment at all?
- **Permitted** — does the acting user's role within the organization allow using it? This is your existing tenant RBAC (`src/lib/rbac.ts`) — Labs does not invent a second permission system. A route/page checks `requirePermission("labs:read")` (or whatever permission the eventual feature needs) exactly as it would for any other capability, separately from the three Labs-specific checks above.

`getOrganizationLabAccess()` / `requireOrganizationLabFeature()` (layer 1–3) never check the acting user's role — that's always the caller's job via the normal tenant-permission guard, called alongside the Labs check, not instead of it.

## Feature registry (`src/lib/labs/registry.ts`)

`LAB_FEATURES` is the single source of truth: a typed `Record<string, LabFeatureDefinition>` built with `as const satisfies Record<string, LabFeatureDefinition>`. `LabFeatureKey = keyof typeof LAB_FEATURES` is derived from it — never hand-listed elsewhere — so passing an unregistered key to any function typed `LabFeatureKey` is a compile-time error. Runtime-facing code (request bodies, URL params) validates against the registry via `isLabFeatureKey()` / `findLabFeature()`, which return a boolean/`undefined` rather than throwing, so an unknown key from outside the app is a clean `LAB_FEATURE_UNKNOWN` denial, never a crash.

Each definition carries:

| Field | Meaning |
|---|---|
| `key` | Stable key, must match its object key. Never reuse a retired key for a different capability. |
| `name`, `description` | Display metadata. |
| `lifecycle` | `INTERNAL \| ALPHA \| BETA \| PREVIEW \| GENERAL_AVAILABILITY \| RETIRED` |
| `requiresEntitlement` | Whether an organization must hold a qualifying plan before enrollment is even considered. |
| `requiresEnrollment` | Whether an explicit `OrganizationLabFeature` row with `status: ENABLED` is required. Every feature today requires enrollment — there is no "entitled implies enabled" shortcut. |
| `internalOnly` | Hard ceiling: can never be enabled for a non-billing-exempt organization, regardless of entitlement or enrollment. |
| `metered` | Whether usage should be recorded via `recordLabUsage()`. |
| `helpText`, `riskClassification` | Optional display/ops context. |

### Reserved keys today

`labsFrameworkPreview` (the only feature actually enrollable — see below), `meetingIntelligence`, `aiAnnouncements`, `policyAssistant`, `executiveCopilot`, `workflowAutomation`. Every one of the five capability placeholders is `lifecycle: "INTERNAL"`, `internalOnly: true` — registered so the enrollment/entitlement/audit machinery has a real typed key to build and test against, not because any of them exist as a product yet. **Promoting a key out of `INTERNAL` is a product decision made later, not an engineering default** — see the rollout example below.

### Entitlement policy default

For a feature with `requiresEntitlement: true`, the resolver's bar is: billing-exempt, or the organization's plan resolves to `elite` (see `requiresElitePlanOrBillingExempt` in `src/lib/labs/access.ts`, which calls the existing `isBillingExempt()`/`getOrgPlan()` from `src/lib/plan-gate.ts` — Labs never re-implements plan resolution). This is a conservative default for "premium/experimental," not a claim made on any pricing page — no Labs feature is customer-visible today. **Revisit this per-feature the moment a real commercial policy exists** for that specific capability; don't assume elite-only is permanent.

## Schema

Two new tables, both additive (no changes to existing tables beyond two new relation arrays on `Organization` and `User`), migration `20260718122711_add_unestra_labs_foundation`:

### `OrganizationLabFeature`

One row per organization+feature (`@@unique([organizationId, featureKey])`); **absence of a row means "not enrolled,"** equivalent to `DISABLED` — not every org needs a row for every feature. `featureKey` is a `String`, validated at the application layer against the registry, not a Prisma enum (the registry is expected to grow; an enum would need a migration per new key — the same reasoning already established for `MfaChallengeToken.type` elsewhere in this schema).

```
id, organizationId, featureKey, status (ENABLED|DISABLED|PENDING|SUSPENDED),
enabledAt, disabledAt, enabledByUserId, disabledByUserId,
enrollmentSource ("operations_center"|"self_service"|"seed"), notes,
createdAt, updatedAt
```

Never stores secrets, API keys, prompts, transcripts, recordings, or AI output — enrollment state only.

### `LabUsageEvent`

Append-only (see Usage metering below):

```
id, organizationId, featureKey, unit, quantity, metadata (Json?), recordedAt
```

## Migration details

- Additive only: two new tables, two new enums (`LabEnrollmentStatus`; `featureKey`/`unit` are plain strings), two new relation arrays. No existing column changed or dropped.
- Includes one guarded, idempotent seed block — mirroring the existing `20260717050000_add_organization_billing_exempt` convention — that enrolls **APH Technologies, LLC only** (matched by immutable organization id, with a name-match guard that aborts the whole migration via `RAISE EXCEPTION` if the id exists under an unexpected name) in `labsFrameworkPreview` with `status: ENABLED`, `enrollmentSource: 'seed'`, and records one `AuditEvent`. If no organization with that id exists (a fresh/dev/CI database), the block `RAISE NOTICE`s and skips — no error, no row created. **No customer organization is ever touched by this migration.**
- Validated against a disposable local Postgres instance in three scenarios: fresh database (skip path), APH organization pre-existing with the correct name (insert + audit path), and APH's id existing under a different name (abort path, whole transaction rolled back). Also validated by applying the full 39-migration production chain first, then this migration on top, with zero conflicts.
- Rollback: a `DROP TABLE` migration reversing the two new tables/enum would be a clean rollback (nothing else references them); the seed insert is contained entirely within this same migration/transaction, so no separate rollback step is needed for it.
- Not applied to production by this PR.

## Access resolver (`src/lib/labs/access.ts`)

`getOrganizationLabAccess(organizationId, featureKey)` returns:

```ts
{
  featureKey, exists, lifecycle,
  entitled,   // org's plan/billing-exempt status satisfies the requirement (true if none is required)
  enrolled,   // an OrganizationLabFeature row exists (true if enrollment isn't required)
  enabled,    // enrollment row status === ENABLED (true if enrollment isn't required)
  available,  // the final answer — can this be used right now
  denialReason: LabDenialCode | null
}
```

Resolution order: unknown key → retired → internal-only ceiling → invalid/non-active organization → entitlement → enrollment → enrollment status (`SUSPENDED`/`DISABLED`/`PENDING`/`ENABLED`). Each branch returns as soon as it has a definitive answer — an unknown feature never triggers a database query at all; internal-only denial never triggers an enrollment lookup.

`requireOrganizationLabFeature(organizationId, featureKey)` calls the resolver and throws `LabFeatureError` (`status`, `code`, `feature`) when `!available` — the authoritative backend gate, called at the narrowest point that performs the gated action, exactly matching `requirePlanFeature()`'s contract from PR #12 (see `docs/entitlements.md`).

`listOrganizationLabAccess(organizationId)` is the organization-facing snapshot for `/settings/labs`: it **excludes internal-only features entirely** for a non-billing-exempt organization (not just denies access to them — an ordinary customer administrator never sees that internal-only rows exist).

**This module never imports or calls anything from `auth-guards.ts`'s platform-authorization surface** (`requireSuperAdmin`, `requirePlatformRole`, `PlatformAccess`) — verified by a dedicated decoupling test. `PlatformAccess` cannot grant, and does not influence, tenant Labs access in either direction.

## Billing-exempt behavior

Identical posture to `docs/entitlements.md`: APH Technologies (the one organization with `Organization.billingExempt = true`) satisfies the *entitlement* layer for any feature that requires one, and satisfies the *internal-only* ceiling. It still must be separately **enrolled** — billing exemption does not auto-enable every experimental capability. The migration seed enrolls APH in exactly one feature (`labsFrameworkPreview`); every other reserved key remains un-enrolled for APH too, including its own internal org, until someone explicitly enrolls it via the Operations Center.

## Internal APH Technologies testing

`labsFrameworkPreview` (`internalOnly: true`, `requiresEntitlement: false`, `requiresEnrollment: true`, `metered: false`) is the safe internal test feature: no AI functionality, no customer-visible claim. `/labs/framework-preview` (ordinary portal, not the Operations Center) renders a preview panel only when `getOrganizationLabAccess` resolves `available: true` for the caller's active organization — proving the full chain (feature exists → not internal-blocked for this org → enrolled+enabled → `labs:read` permission) end to end from an ordinary org-session context, not through platform-operator tooling. A button on that panel calls `recordLabUsage()` with a static, contentless metadata payload (`{ action: "preview_panel_viewed" }`) to exercise the usage-metering interface too.

Switching the active organization never carries this access with it — `getOrganizationLabAccess` re-reads `organizationId` fresh on every call (verified by a dedicated cross-tenant test), so a platform operator who happens to also be a member of a customer organization gets that organization's real (denied) access, never APH's.

## Operations Center (`/admin/platform/labs`)

Guarded by `requireSuperAdmin()` (both the shared `/admin/platform` layout and defense-in-depth on the page itself, matching every other Operations Center page). Shows:

- The full feature registry (key, lifecycle, internal-only/entitlement/enrollment/metered flags) — read-only.
- A filterable, paginated list of organization enrollments (by feature key and/or organization id), each joined live against the organization's current name/slug.
- Per-row Enable/Suspend/Disable actions and a "set enrollment" form for a new organization+feature pair — each gated behind an inline two-step confirm (not a native `window.confirm`, which blocks the harness and is worse for accessibility/testability).
- A per-enrollment history view (`/admin/platform/labs/[enrollmentId]`) reconstructed from `AuditEvent` — no separate history table; every write already goes through the same audit-logging call, so a second append-only log would be redundant.

The sole write path is `setOrganizationLabEnrollment()` (`src/lib/platform-operations/labs.ts`), reached only via `PUT /api/admin/labs/enrollments`. It:

- Validates the feature key against the registry and the organization's existence before writing anything.
- **Rejects enabling (`ENABLED`/`PENDING`) an internal-only feature for a non-billing-exempt organization** — the access resolver would deny it anyway, but allowing the enrollment row itself to claim `ENABLED` would be a misleading operator-facing state, closed at the write layer too, not just the read layer. `DISABLED`/`SUSPENDED` transitions remain open unconditionally (cleanup is never blocked).
- Never touches `Organization.plan`, Stripe, `Organization.billingExempt`, or any `OrganizationMembership`/RBAC row — verified by a test asserting only the one `organizationLabFeature.upsert` call happens.
- Always audit-logs (`labs.enrollment.status_changed`, previous status, new status, acting user, optional note).
- The API route requires an explicit `confirm: true` field in the request body — a stray or replayed request without it is rejected with a 400, not silently applied.

## Organization-facing behavior (`/settings/labs`)

Read-only for this PR, reachable only with the new `labs:read` RBAC permission (`ORG_OWNER`/`ORG_ADMIN` only — the same distribution as `org_settings:read`; `FINANCE`/`STAFF`/`READ_ONLY`/`MEMBER` don't get it). Shows an experimental-feature warning banner and, for each feature visible to that organization (internal-only rows excluded unless the organization itself is billing-exempt), whether it's enabled and — if not — a customer-safe reason (`"Not included in your current plan"`, `"Not yet enabled for your organization"`, etc., never the raw `LAB_DENIAL_CODE` or any operator-only detail). No self-service enable/disable/request-enrollment action exists yet — with every registered feature `internalOnly: true`, there is nothing a customer organization could enable today, so building that workflow now would be exercising unused code paths. Activation is Operations-Center-only until a real Labs feature is promoted out of `INTERNAL`.

## Error contract

Every denial from `requireOrganizationLabFeature()` is a `LabFeatureError` (`status: 403`), caught centrally in `withApiErrorHandling` (`src/lib/api-route.ts`, the same helper `docs/entitlements.md` established) and serialized as:

```json
{ "ok": false, "error": "This organization is not enrolled in this Labs feature.", "code": "LAB_FEATURE_NOT_ENROLLED", "feature": "meetingIntelligence" }
```

Stable codes: `LAB_FEATURE_UNKNOWN`, `LAB_FEATURE_INTERNAL_ONLY`, `LAB_FEATURE_NOT_ENTITLED`, `LAB_FEATURE_NOT_ENROLLED`, `LAB_FEATURE_DISABLED`, `LAB_FEATURE_SUSPENDED`, `LAB_FEATURE_RETIRED`, `LAB_FEATURE_NOT_ENABLED` (the last is also the generic fallback for cases that must not leak detail — an invalid/missing organization, or a `PENDING` enrollment row — rather than inventing an undocumented code). Any route calling a Labs guard must use `withApiErrorHandling`, not the narrower `withForbiddenHandler` — the latter only understands `ForbiddenError` and would turn a Labs denial into an unhandled 500 (the exact gap PR #12 found and fixed for `PlanFeatureError`).

## Audit logging

Every enrollment status change writes one `AuditEvent`: `action: "labs.enrollment.status_changed"`, `organizationId`, `resourceId` (the enrollment row's id), `actorId`/`actorEmail`, and `metadata: { featureKey, previousStatus, newStatus, notes }`. The migration's seed enrollment writes its own `labs.enrollment.seeded` event with `actorEmail: "system@migration"` (no human actor). Never logs secrets, tokens, transcripts, recordings, or prompts — there is no field on the audit path that could carry them, since the enrollment write path itself never touches that kind of data. Platform-only detail (which admin made the change, operator notes) is visible solely through the Operations Center's history view (`requireSuperAdmin`-gated); the organization-facing `/settings/labs` page never queries `AuditEvent` at all.

## Usage metering foundation

`recordLabUsage({ organizationId, featureKey, unit, quantity, metadata })` (`src/lib/labs/usage.ts`) is the sole write path into the append-only `LabUsageEvent` table — no update or delete is exposed anywhere. `unit` is a fixed, extensible string vocabulary (`audio_minutes`, `meetings_processed`, `ai_tokens`, `documents_analyzed`, `reports_generated`, `automation_executions`) chosen to cover the capability placeholders' likely future needs without over-specifying them yet. `metadata` is typed `Record<string, string | number | boolean | null>` — a flat record of primitives, not a nested object — a structural constraint, not just a convention, so a future caller physically cannot pass a transcript/recording/prompt payload through this field without it failing to type-check. **Not connected to Stripe, not billed, not invoiced, no Stripe price/product created.**

## Privacy and security foundations

Documented now, ahead of any feature that would actually exercise them:

- **Human review for AI-generated official content** — no Labs capability may auto-publish AI output (meeting minutes, announcements, etc.) without an explicit human action. This framework enforces nothing about content yet (none exists), but every future feature built on it must preserve this.
- **No automatic publication of AI-generated minutes.**
- **Organization ownership of submitted content** — any document/recording/data an organization submits to a future Labs feature remains theirs; Labs infrastructure processes it on their behalf, never repurposes it.
- **Explicit user action before processing sensitive data** — no background job may start processing member/financial/meeting content without the organization having explicitly triggered it.
- **Data retention and deletion support** — deferred to each feature's own design (nothing to retain yet), but any feature handling recordings/transcripts must define a retention window and support deletion before shipping.
- **Tenant isolation** — every Labs check resolves `organizationId` from trusted server-side session/permission data, never a client-supplied value (see Security review below).
- **Encryption in transit and at rest** — inherited from the platform's existing infrastructure (DigitalOcean Managed Postgres, TLS everywhere); no Labs-specific exception.
- **No training-use assumption** — nothing in this framework grants Unestra or any third party a right to use organization content for model training; that would require an explicit contractual basis established separately from this framework.
- **Visible experimental-feature notice** — `/settings/labs` always shows a warning banner; any future feature-specific UI must carry its own.
- **Clear AI output disclaimer** — deferred to each feature (none produces AI output yet).
- **Ability to disable a Labs feature** — built in today: any `ENABLED` enrollment can be moved to `DISABLED` via the Operations Center, audited, effective immediately (the resolver re-checks fresh on every call).
- **Auditability of enrollment and processing** — enrollment changes are fully audited today; per-feature *processing* audit trails are each feature's own responsibility to add when built.

## Security review

Verified (with tests) for the framework's current surface:

- **Client-side state cannot enable a feature** — `available` is computed server-side on every call; there is no cached/client-settable flag.
- **Changing the organization ID cannot affect another tenant** — every check take `organizationId` from `requirePermission()`/`requireSuperAdmin()`, session-resolved, never from client input; the Operations Center's write route takes an explicit `organizationId` field but only `requireSuperAdmin` (platform-wide) can reach it, and the write is scoped to exactly that id.
- **One organization's enrollment cannot be used for another's** — the unique `organizationId+featureKey` composite key and the resolver's per-call fresh lookup both prevent this; a dedicated test confirms back-to-back calls for two different orgs never cross-contaminate.
- **`PlatformAccess` alone does not grant Labs access** — `access.ts` has zero references to platform authorization (dedicated decoupling test); a platform operator must still separately hold `labs:read` (or better) in whatever organization context they're checking, exactly like every other tenant permission.
- **Organization membership alone does not bypass enrollment** — `requireOrganizationLabFeature` always checks enrollment (when required) regardless of the caller's role; RBAC and enrollment are independent gates, both must pass.
- **Retired/suspended features cannot be used** — both are explicit, tested denial branches, checked before enrollment status is even considered relevant (retired) or as soon as the enrollment row is read (suspended).
- **Enrollment cannot be bypassed via a direct API request** — `PUT /api/admin/labs/enrollments` is the only enrollment-write surface, `requireSuperAdmin`-gated; there is no other route, and no Labs feature route (once built) will ever accept an enrollment override from its own request body.
- **No background job exists yet to bypass** — no Labs capability has a worker today; the framework's guard is designed to be called from a worker exactly like a route (see the rollout example below), and Phase 8/concurrency guidance in `docs/entitlements.md` (re-check at execution time, not just at scheduling time) applies identically once one exists.
- **Internal-only features cannot be activated for a customer** — enforced at both the read layer (resolver) and the write layer (`setOrganizationLabEnrollment` rejects the attempt outright), independently.
- **Feature keys can't be manipulated via unsafe string input** — every write and read path validates against the registry (`isLabFeatureKey`/`findLabFeature`) before doing anything else; an unrecognized string is `LAB_FEATURE_UNKNOWN`, never passed through to a query.
- **No mass assignment** — the enrollment route's request schema (zod) enumerates exactly `organizationId`, `featureKey`, `status` (enum), `notes`, `confirm` — nothing else is accepted, let alone written.
- **Platform-only enrollment notes are not exposed to organizations** — `LabAccessResult` (what `/settings/labs` reads) has no `notes` field at all; `notes` only exists on `LabEnrollmentListItem` (Operations-Center-only).
- **APH's internal access cannot transfer to another organization** — there is no code path that copies or references one organization's enrollment row while resolving or writing another's.

## Tenant isolation

Every Labs function that takes an `organizationId` sources it from already-authenticated, server-side session data (`requirePermission`, `requireSuperAdmin`) — the same pattern established for plan entitlements in `docs/entitlements.md`. No Labs route accepts an organization id from a client that wasn't already authorized for that organization by an existing guard.

## Background jobs / concurrency

No Labs feature has a background job today. When one exists, follow the pattern already established for email campaigns (`docs/entitlements.md`): check entitlement/enrollment before scheduling, **re-check at actual execution time** (not just at scheduling time), and on denial mark the scheduled work as failed/blocked with an audit event rather than leaving it to be silently retried forever.

## Developer checklist: adding a new Labs feature

1. Add the key to `LAB_FEATURES` in `src/lib/labs/registry.ts` with its real `lifecycle`, `requiresEntitlement`, `requiresEnrollment`, `internalOnly`, and `metered` values — `LabFeatureKey` picks it up automatically.
2. Define its entitlement policy explicitly if `requiresEntitlement: true` and the default (elite/billing-exempt) isn't right for this specific feature — don't assume the default is always correct.
3. Add backend enforcement: `await requireOrganizationLabFeature(organizationId, "yourFeature")` at the narrowest point that performs the gated action, alongside (not instead of) the normal tenant-permission check for that action.
4. Add background-worker enforcement if the feature has any asynchronous execution — re-check at execution time.
5. Add UI availability handling sourced from `getOrganizationLabAccess()`/`listOrganizationLabAccess()` — never re-derive the logic in a component.
6. Add audit logging for enrollment changes (already covered generically by `setOrganizationLabEnrollment`) and for the feature's own significant actions (e.g., a meeting transcription starting/completing).
7. Add tests: entitled/denied/trial/billing-exempt/cross-tenant, the standardized error shape, and anything feature-specific.
8. Update this document.
9. Do not add Stripe pricing, a new plan tier, or a customer-facing availability claim without separate, explicit billing/product approval — that's a commercial decision, not an engineering one.

## Rollout process

1. Register the key in `INTERNAL` lifecycle (internal-only, no promises).
2. Build and test the capability against APH Technologies via an explicit Operations Center enrollment.
3. Move lifecycle to `ALPHA`/`BETA` when ready for a limited external cohort; enroll specific customer organizations individually via the Operations Center — enrollment is always an explicit, audited, per-organization action, never a blanket flip.
4. Move to `PREVIEW` once broadly stable; still opt-in per organization.
5. Promote to `GENERAL_AVAILABILITY` only alongside an explicit product/pricing decision (this is the point where a real entitlement policy and, if applicable, pricing get decided — not before).

## Retirement process

1. Set `lifecycle: "RETIRED"` in the registry — the resolver denies every organization immediately (`LAB_FEATURE_RETIRED`), regardless of prior enrollment status.
2. Existing `OrganizationLabFeature` rows for the key are left as historical record (not deleted) — the audit trail and enrollment history remain queryable.
3. Communicate the retirement and any data-retention/export window to enrolled organizations through the feature's own UI before flipping the lifecycle, if the feature has processed any of their content.
4. Never reuse a retired key for a different capability.

## Future Meeting Intelligence example (not implemented)

Illustrates how a real capability plugs into this framework — no part of this is built in this PR:

```text
Register meetingIntelligence            → already reserved (INTERNAL, internalOnly, requiresEntitlement, requiresEnrollment, metered)
Define entitlement policy               → confirm elite-only default is actually right, or set a real policy
Create organization enrollment          → Operations Center enrolls APH first, then pilot customers
Add tenant permission                   → e.g. meetings:transcribe, granted per role like any other permission
Protect API routes                      → requireOrganizationLabFeature() + requirePermission() at upload/start-transcription endpoints
Protect background workers              → re-check at job execution, not just at enqueue time
Record usage                            → recordLabUsage({ unit: "audio_minutes", ... }) per processed meeting
Add review UI                           → human approval step before any AI-generated minutes are treated as official
Add privacy and retention controls      → recording/transcript retention window, deletion support, explicit disclaimer
Run internal APH pilot                  → real meetings, real feedback, before any customer sees it
Run limited customer beta               → ALPHA/BETA lifecycle, hand-picked enrolled organizations
Promote lifecycle when approved         → PREVIEW → GENERAL_AVAILABILITY alongside a real commercial decision
```
