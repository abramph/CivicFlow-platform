# PR #40: Graduating PTA/PTO from Labs into a First-Class Vertical

## Why

PTA/PTO launched as a Labs-gated pilot (`docs/pta-labs-mvp.md`) behind a
dual-gate system: an organization needed **both** `primaryVertical === "PTA"`
**and** a separate `OrganizationLabFeature` enrollment row
(`featureKey: "ptaVertical"`, `status: "ENABLED"`) to get the PTA experience.
This produced real contradictory states — an organization correctly
classified `PTA` by Platform Admin could still see "not available for this
organization" everywhere, or (worse) disappear entirely from a parent's
organization switcher, if the Labs enrollment step was ever missed, reverted,
or simply never performed. `resolveEffectiveVertical()` silently downgraded
such an organization to the `COMMUNITY` experience rather than surfacing the
mismatch.

PTA/PTO has proven out as a real product line. This PR removes the Labs
dependency for core PTA functionality: **`primaryVertical === "PTA"` alone
is now sufficient and authoritative.** Labs remains reserved for genuinely
optional/experimental PTA features, if and when any exist.

## What changed, in one sentence per area

- **Access control**: every core PTA route/page/mobile-API guard now checks
  `Organization.primaryVertical === "PTA"` (plus org/household/membership
  status) directly — never Labs enrollment. See
  `docs/pta-access-architecture.md`.
- **`resolveEffectiveVertical()`**: now a pure passthrough — no fallback, no
  Labs lookup, no database query at all.
- **Labs registry**: `ptaVertical` is now `lifecycle: "RETIRED"` — hidden
  from new enrollment, blocked from future writes, existing rows preserved
  as inert history. See `docs/labs-feature-lifecycle.md`.
- **Signup/onboarding**: creating a `PTA` organization routes straight to
  PTA onboarding with no Platform Admin step in between. See
  `docs/pta-onboarding.md`.
- **Platform Admin**: the organization-type-correction screen no longer
  warns about Labs/vertical mismatches for PTA — there's nothing left to
  mismatch.
- **Mobile**: PTA capability resolution (`/api/mobile/organizations`,
  `mobile-auth.ts`) derives from `primaryVertical`, not Labs, with no
  backward-compatibility break (existing response shape unchanged).
- **Data**: no schema change, no migration. Existing `ptaVertical`
  `OrganizationLabFeature` rows are untouched in the database — they are
  simply no longer read by anything that grants access.

## What did NOT change

- No new PTA business features, no pricing change, no UnionFlow change, no
  HOA work — out of scope by explicit instruction.
- Household-adult (parent) authorization model and officer RBAC are
  unchanged in substance — same permission checks, same tenant scoping,
  just reached through the new resolver instead of a Labs check bolted onto
  the front of each route.
- The `/labs/pta/*` route namespace is unchanged (see
  `docs/pta-access-architecture.md` § Route compatibility) — renaming it is
  explicitly deferred, not part of this PR.
- Existing PTA organizations (Pine Grove, Riverside) keep 100% of their
  data — households, dues, minutes, volunteer history, audit trail — with
  zero interruption.

## Architecture discovery that shaped this PR

Nearly the entire PTA route/page surface (~65 files) funnels through exactly
three exported functions in `src/lib/labs/pta/guard.ts`
(`requirePtaAccess`, `getPtaPageGate`, `requirePtaHouseholdSelfAccess`).
Fixing those three functions' internals fixed all ~65 call sites without
touching them individually. A smaller set (~9 files) called
`getOrganizationLabAccess`/`requireOrganizationLabFeature("ptaVertical")`
directly, bypassing `guard.ts`; those needed individual fixes, listed in
`docs/pta-access-architecture.md`.

## Known limitations

- No live production PTA-enrollment/primary-vertical counts are included in
  this PR's validation — production database access for read-only counts
  was intentionally not attempted (see the standing rule against querying
  production credentials directly). Local disposable-Postgres data was used
  as illustrative, not authoritative.
- The `/labs/pta/*` URL namespace still says "labs" even though the feature
  is no longer Labs-gated — this is a cosmetic/compatibility debt, not a
  functional one, and is explicitly deferred (see
  `docs/pta-access-architecture.md`).

## Recommended next phase

Per the originating spec: **Unestra Union experience refinement →  HOA
domain discovery and data-model design.** Union or HOA implementation work
must not begin as part of this PR.
