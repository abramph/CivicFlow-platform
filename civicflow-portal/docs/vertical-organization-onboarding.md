# Vertical Organization Creation & Guided Onboarding

## What this completes

Before this PR, two organization-creation paths existed and only one of them ever asked for a vertical:

- `/signup` (`SignupForm.tsx` → `/api/auth/signup`) created a **User + Organization + Membership + OrgSettings** in a single step, with no vertical field at all — every organization created this way silently defaulted to `COMMUNITY`.
- `/onboarding/organization` (`OrganizationOnboardingForm.tsx` → `/api/onboarding/organization`) already required a vertical, but was reachable only via a direct link, not the main signup flow.

This PR makes vertical selection universal and mandatory, and completes the guided-onboarding experience after creation.

## New sequence

1. `/signup` now creates **only the personal account** (email, password, display name) — no organization, no vertical decision yet.
2. Email verification (unchanged).
3. Login with no organization lands on `/onboarding/organization`, which now shows a **choice screen** (`OrganizationSetupChoice.tsx`): "Create a new organization" (reveals the existing vertical-selection wizard) or "Join an existing organization" (informational — points to the real, existing invite-based join mechanism; no self-service org search/join-request was built, since that would be a new business feature).
4. Creating an organization still requires choosing one of the four vertical cards — `primaryVertical` is a required enum with no default at the API layer (`/api/onboarding/organization`), so it can't be skipped or postponed.
5. `Organization.primaryVertical` is saved immutably (unchanged from PR #37's confirmation workflow — Platform Admin correction remains the only path to change it later).
6. Redirect to the appropriate onboarding experience via a new `getOnboardingRoute(vertical)` resolver (`src/lib/vertical-navigation.ts`, alongside the existing `getLandingRoute`): PTA keeps its own rich Labs checklist (`/labs/pta/onboarding`, unchanged); Community, Union, and HOA share one generic checklist page (`/onboarding/checklist`) that renders different steps per vertical.

## Vertical selection cards

Each of the four cards (`VERTICAL_SELECTION_CARDS` in `vertical-terminology.ts`) now includes an icon, a short description, concrete examples, a one-line terminology preview (e.g. "Residents pay Assessments; a Board governs."), and the existing highlight chips — all pure data, consumed by `OrganizationOnboardingForm.tsx` which maps icon names to actual Lucide components.

## Onboarding checklist (`/onboarding/checklist`)

One page, vertical-aware steps computed from real data (no new models):

- **Community**: organization profile, invite members, create first event, send first announcement.
- **Union**: dues setup, payroll checkoff overview (links to the bulk payment-import tool from PR #38), member import, officers (Users & Roles), communications.
- **HOA**: board information (Users & Roles), invite residents — plus a persistent notice that property tracking and further HOA capabilities aren't built yet ("HOA properties are tracked as members for now... Additional HOA capabilities will appear as they are enabled.").

Every link goes to a real, already-working page — the same principle as the existing PTA checklist.

## Other fixes made along the way

- `select-organization`'s "Create a new organization" link pointed at `/signup` (correct before this PR, dead-end after it) — now points at `/onboarding/organization`.
- `/events`, `/meetings`, and `/members` (the two genuine "no vertical-specific message" gaps found) now use `getEmptyStateCopy()`/vertical terminology instead of hardcoded Community-flavored text; `/dues` and `/members` page titles/actions now use vertical terminology instead of hardcoded "Dues"/"Members".
- A pre-existing color-contrast failure in the onboarding wizard's step indicator (`text-slate-400` inactive-step labels) — found via axe-core while validating this PR's accessibility requirement — fixed to `text-slate-600`.

## Explicitly not done (by design)

- No self-service organization search/join-request flow — out of scope as a new business feature. "Join an existing organization" surfaces the real existing mechanism (email invite) instead of a placeholder.
- No UnionFlow or HOA domain models — Union and HOA onboarding steps are guided tours through existing generic capabilities only.
- No subscription/billing logic changes.
- No new verticals.
- A remaining, pre-existing (not introduced here) product gap: selecting "PTA / PTO" at signup does not auto-enroll the new organization in the `ptaVertical` Labs feature (there is no self-service enrollment path — Platform Admin only, by design per PR #36). A brand-new PTA-vertical organization correctly and gracefully falls back to the Community experience (`resolveEffectiveVertical`) and its onboarding checklist shows "Not available for this organization" until a Platform Admin enables it. This is documented, not silently broken — closing it (e.g. auto-enrolling PTA Labs at creation time) is a product decision for a future PR, not assumed here.
- Not every page's title/empty-state was swept for vertical terminology (a mechanical, large-surface-area task) — `/events`, `/meetings`, `/members`, `/dues` were fixed as the highest-traffic top-level pages; deeper nested pages (dues charge/payment detail, accounts, reminders) still show generic "Dues"-flavored copy.

## Mobile

`/api/mobile/organizations`'s `capability` object (added in PR #36) already exposes `primaryVertical`, `terminology`, `landingPage`, and `quickActions` per organization — verified still complete and unchanged; no gap found here.
