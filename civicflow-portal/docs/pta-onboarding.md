# PTA/PTO Onboarding (post PR #40)

## Signup → onboarding, with zero Platform Admin steps in between

1. A new organization is created via `OrganizationOnboardingForm.tsx`,
   selecting **PTA-PTO** from `VERTICAL_SELECTION_CARDS`.
2. The creation API sets `Organization.primaryVertical = "PTA"` at creation
   time. **No `OrganizationLabFeature` enrollment row is created** — this is
   the specific behavior change from before PR #40, where a Labs enrollment
   was a separate, Platform-Admin-only step required before the org could
   actually use PTA features.
3. The client reads the created organization's `primaryVertical` back from
   the API response and routes accordingly:
   `router.push(payload?.data?.primaryVertical === "PTA" ? "/labs/pta/onboarding" : "/dashboard")`
   (`src/components/forms/OrganizationOnboardingForm.tsx`).
4. `/labs/pta/onboarding` loads immediately for the new org's owner. The
   shared PTA layout (`src/app/labs/pta/layout.tsx`) checks
   `organization.primaryVertical === "PTA" && organization.status === "active"`
   directly against the database — there is no Labs check anywhere in this
   path, and therefore no "not available for this organization" dead end.

No Platform Admin needs to take any action for a brand-new PTA organization
to become fully usable. This is the core Phase 7 requirement this PR
satisfies.

## What the onboarding checklist covers

`/labs/pta/onboarding` is the existing, real PTA setup checklist (unchanged
by this PR) — it guides a new PTA organization's first officer through
initial setup (households, school year, initial officer roles, etc.). It is
reachable at any time afterward via the PTA tab bar's "Onboarding" tab
(visible to anyone with `pta:households:manage`), not just immediately after
signup.

## Existing organizations

Existing PTA organizations (Pine Grove, Riverside) already had
`primaryVertical = "PTA"` set (via the historical backfill described in
`docs/organization-vertical-lifecycle.md`) and are unaffected by this
change — they continue to load the PTA experience exactly as before, now
with one fewer (redundant) gate to pass.

## Route namespace note

The onboarding route lives at `/labs/pta/onboarding` — the `labs/` segment
in the URL is legacy naming and does not imply a Labs enrollment
requirement. See `docs/pta-access-architecture.md` § Route compatibility.
