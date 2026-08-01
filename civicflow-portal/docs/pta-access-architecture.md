# PTA/PTO Access Architecture (post PR #40)

## The rule

Core PTA/PTO access requires, and requires only:

1. `Organization.primaryVertical === "PTA"`
2. `Organization.status === "active"`
3. A valid user relationship to that organization:
   - **Officer**: an active `OrganizationMembership` with a role other than
     `MEMBER`, carrying whatever RBAC permission the specific action needs.
   - **Parent (household self-service)**: a `PtaHouseholdAdult` row linking
     the user to a household in that organization, with the household's
     `status === "ACTIVE"`.

Labs enrollment (`OrganizationLabFeature`, any `featureKey`) is **never**
part of this check for core PTA functionality. It remains relevant only for
genuinely optional/experimental PTA features, gated separately (see
"Optional Labs features" below) — there are none as of this PR.

## Central guard: `src/lib/labs/pta/guard.ts`

All core PTA authorization funnels through this one file.

- **`requirePtaVertical(organizationId)`** — the primitive. Loads the
  organization's `primaryVertical`/`status`, throws
  `PTA_ORGANIZATION_NOT_PTA_VERTICAL` if not PTA, throws
  `PTA_ORGANIZATION_INACTIVE` if inactive, otherwise returns the row.
- **`checkPtaVerticalAvailable(organizationId)`** — non-throwing wrapper
  around the above, returning `{ available: boolean }`. Drop-in replacement
  for the old `getOrganizationLabAccess(...).available` pattern.
- **`requirePtaAccess(permission)`** — for officer-gated routes. Composes
  the existing tenant/RBAC guard (`requirePermission`) with
  `requirePtaVertical`. Unchanged in what it demands of RBAC; changed only
  in what it demands of the organization.
- **`getPtaPageGate(permission)`** — page-level variant that never throws;
  returns `{ access: { available } }` for pages that render their own
  "not available" UI rather than a thrown error.
- **`requirePtaHouseholdSelfAccess()`** — for parent self-service routes.
  Composes `requirePtaVertical` with a `PtaHouseholdAdult` lookup and an
  `ACTIVE` household-status check. Throws `PTA_NOT_A_HOUSEHOLD_MEMBER` or
  `PTA_HOUSEHOLD_INACTIVE` as appropriate.
- **`getPtaOrganizationAccessContext(organizationId, userId)`** — the
  full-context resolver (Phase 5). Returns organization identity, officer
  identity + role + effective permissions, household-adult identity +
  household status, an `effectivePtaAccess` boolean, and any genuinely
  enabled Labs features for that org (informational only — never used to
  grant core access). Intended for any caller that needs the whole picture
  at once rather than a single yes/no.
- **`getLegacyPtaLabsEnrollmentStatus(organizationId)`** — thin wrapper
  around `getOrganizationLabAccess(organizationId, "ptaVertical")`, kept only
  for any code path that still wants to display the historical enrollment
  state (e.g. Platform Admin audit views); never used for access decisions.

## Error codes

`src/lib/labs/pta/errors.ts` distinguishes denial reasons precisely (Phase
17 requirement — no generic "not available" for core PTA denials):

| Code | HTTP | Meaning |
|---|---|---|
| `PTA_ORGANIZATION_NOT_PTA_VERTICAL` | 403 | Organization's `primaryVertical` isn't `PTA`. |
| `PTA_ORGANIZATION_INACTIVE` | 403 | Organization is PTA but not `active`. |
| `PTA_NOT_A_HOUSEHOLD_MEMBER` | 403 | User has no household link in this org. |
| `PTA_HOUSEHOLD_INACTIVE` | 403 | Household exists but isn't `ACTIVE`. |
| *(existing RBAC codes)* | 403 | Officer lacks the specific permission. |

No stack traces or internal identifiers are exposed in any of these.

## Everything that funnels through `guard.ts` vs. direct call sites

~65 PTA pages/routes call one of the three exported guard functions above
and needed no individual changes — fixing `guard.ts` fixed all of them.

A smaller set bypassed `guard.ts` and called
`getOrganizationLabAccess`/`requireOrganizationLabFeature("ptaVertical")`
directly; these were changed individually to use
`checkPtaVerticalAvailable`/`requirePtaVertical`:

- `src/app/api/labs/pta/access/route.ts`
- `src/app/api/labs/pta/minutes/route.ts`
- `src/app/api/labs/pta/volunteers/opportunities/route.ts`
- `src/app/labs/pta/membership/page.tsx`
- `src/app/labs/pta/my-household/page.tsx`
- `src/app/labs/pta/volunteers/page.tsx`
- `src/app/m/my-household/page.tsx`
- `src/app/labs/pta/layout.tsx` (checks the organization directly)

Two further layers had their own independent Labs-gating implementations,
also fixed:

- `src/lib/mobile-auth.ts` — `requireMobilePtaHouseholdAccess` and
  `requireMobileStaffPermission` now call a private
  `requirePtaVerticalForMobile(organizationId)` helper defined in the same
  file (not imported from `guard.ts`, to avoid a cross-layer dependency
  between the mobile-auth layer and the web-specific Labs/PTA guard layer).
- `src/lib/org-context.ts` (`getUserOrgMemberships`) and
  `src/app/api/mobile/organizations/route.ts` — both used Labs access as an
  **inclusion filter** for a PTA parent's org-switcher/organizations-list
  entries. This was the worst failure mode under the old architecture: a
  real PTA parent at a Labs-non-enrolled-but-`primaryVertical`-PTA org would
  see **zero organizations** in their switcher, not just a page-level "not
  available" message. Both now check `organization.primaryVertical !== "PTA"`
  directly instead.

## `resolveEffectiveVertical()` — removed fallback

`src/lib/organization-experience.ts` previously fell back a `PTA`-classified
organization to `COMMUNITY` until Labs enrollment existed. This function is
now a pure passthrough:

```ts
export async function resolveEffectiveVertical(
  _organizationId: string,
  primaryVertical: OrganizationVertical
): Promise<OrganizationVertical> {
  return primaryVertical;
}
```

`primaryVertical = PTA` resolves to the PTA experience immediately, always.
If a genuine configuration defect exists in the future, the correct response
is a controlled setup error — not a silently different product experience.
The function signature (including the now-unused `organizationId` parameter)
is kept as-is to avoid a churn-only signature change across its call sites.

## Existing organizations — migration strategy

No schema change, no migration. Existing `OrganizationLabFeature` rows for
`ptaVertical` are left in the database untouched — they become inert
history rather than being deleted (Phase 8 "Option A + B combined"). See
`docs/labs-feature-lifecycle.md` for how retirement is enforced.

## Optional Labs features

None exist for PTA as of this PR. If a genuinely experimental PTA feature
is ever added (e.g. `ptaAdvancedAnalyticsPreview`,
`ptaVolunteerForecastingPreview`), it must register its own unique Labs key
and be gated independently of core PTA access — `ptaVertical` must never be
reused for a different feature.

## Route compatibility

`/labs/pta/*` route paths are unchanged. The route namespace is legacy;
**access is controlled by `primaryVertical`, not by the route's name or by
Labs enrollment.** Renaming the namespace is deferred — out of scope for
this PR — and is tracked as a cosmetic follow-up, not a security concern
(the guard functions above are the only source of truth regardless of URL).
