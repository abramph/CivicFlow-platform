# Vertical Experience Layer

This document covers the "experience layer" built on top of the vertical
architecture introduced in PR #35 (`Organization.primaryVertical`). It makes
Community, PTA/PTO, Union, and HOA organizations feel like differentiated,
purpose-built products while remaining one shared platform, one database,
one authentication system, and one codebase.

Do not confuse this with a request to build Union- or HOA-specific business
functionality — that is explicitly out of scope here and is tracked as
**PR #37 — Unestra Union Discovery, UnionFlow Capability Audit, Domain Model,
and Union MVP**. This layer is the navigation/dashboard/terminology/onboarding
scaffold those future verticals will plug into; Union and HOA today reuse the
exact same routes and data model as Community, just relabeled.

## Architecture

Everything server-derivable lives behind one function,
`resolveOrganizationExperience()` (`src/lib/organization-experience.ts`),
which pages/routes call instead of recombining vertical + entitlements +
Labs + permissions themselves:

```ts
resolveOrganizationExperience({ organizationId, role }) -> {
  primaryVertical,      // effective vertical — see "Effective vs. raw vertical" below
  status,
  role,
  permissions,          // from getEffectivePermissions — never recomputed here
  entitlements,         // from getOrganizationEntitlements — subscription/plan
  enabledLabFeatures,   // ENABLED OrganizationLabFeature rows for this org
  terminology,          // getVerticalTerminology(vertical)
  navigation,           // getNavigationProfile(vertical), already permission-filtered
  quickActions,         // getQuickActions(vertical)
  helpTopics,           // getHelpTopics(vertical)
  landingPage,          // "/dashboard" or "/labs/pta/dashboard"
}
```

Four small, pure, side-effect-free modules hold the actual per-vertical data,
each independently unit-tested:

- `src/lib/vertical-navigation.ts` — `getNavigationProfile(vertical)`
- `src/lib/vertical-terminology.ts` — `getVerticalTerminology`,
  `getQuickActions`, `getHelpTopics`, `getEmptyStateCopy`,
  `VERTICAL_SELECTION_CARDS`
- `src/lib/organization-experience.ts` — the composing resolver plus
  `resolveEffectiveVertical`

### Effective vs. raw vertical

`Organization.primaryVertical` (the column) is the raw, stored,
Platform-Admin-controlled classification. PTA Labs enrollment
(`OrganizationLabFeature`, `featureKey: "ptaVertical"`) has **no self-service
path** — every real enrollment row today has `enrollmentSource:
"operations_center"`, meaning only a Platform Admin can turn it on. If an
organization were classified `PTA` but not (yet) enrolled, giving it PTA
navigation and a PTA dashboard redirect would point at pages that all say
"not available for this organization" — a dead end the spec explicitly
prohibits.

`resolveEffectiveVertical(organizationId, primaryVertical)` closes this gap:
it falls back to `COMMUNITY` for a `PTA`-classified org until Labs enrollment
actually exists. The moment Platform Admin enables it, the same org
seamlessly gets the full PTA experience — no further action needed.

**Where reconciliation happens (and where it deliberately doesn't):**

- `authOptions.ts`'s session callback reconciles **once, for the active
  organization only** — this is what `session.primaryVertical` (and
  therefore `PortalShell`'s nav and the dashboard's PTA redirect) is built
  from.
- `resolveOrganizationExperience()` reconciles the same way for its own
  `organizationId` argument.
- `getUserOrgMemberships()` (`org-context.ts`) — the list backing the
  organization **switcher** — deliberately does **not** reconcile each
  entry. That function runs on every session hydration, for every
  organization a user belongs to; reconciling every entry would mean an
  extra Labs-access database query per organization per session read. Since
  the switcher itself doesn't render vertical-specific content (it's just
  organization names in a dropdown), this raw value is fine there. The
  post-switch redirect decision (`PortalShell.switchOrganization`) instead
  waits for the refreshed session — which *is* reconciled — rather than
  trusting the pre-switch raw value.

  This split was discovered by manual testing, not designed upfront: an
  earlier version reconciled every switcher entry and measurably increased
  per-request database load in a way that, combined with an already-thin
  connection ceiling on the shared database this project uses for both dev
  and production, could exhaust available connections. Fixed before this PR
  merged.

## Navigation

`getNavigationProfile(vertical)` returns one list per vertical. Every `href`
points at a route that already exists and works today — no dead ends.

- **PTA** gets a fully distinct list (Unestra Labs routes:
  `/labs/pta/dashboard`, `/labs/pta/households`, etc.) — it never shows
  Community wording, per the explicit requirement.
- **Community, Union, and HOA share the exact same underlying route set**
  (they are, today, the same generic feature set) — only labels differ:

  | Route | Community | Union | HOA |
  |---|---|---|---|
  | `/dashboard` | Dashboard | Union Dashboard | Community Dashboard |
  | `/campaigns` | Fundraising | Campaigns | Campaigns |
  | `/dues` | Dues | Union Dues | Assessments |
  | `/settings/users` | Users & Roles | Officers | Board |
  | `/communications` | Communications | Communications | Announcements |

- **Deliberately omitted** for Union/HOA/Community alike: a standalone
  "Documents" library (no generic document-library page exists outside PTA
  Labs today — attachments are per-entity, via `AttachmentManager`, on
  campaign/event/meeting/member/org-settings detail pages), a distinct
  "Officers"/"Board" roster separate from Users & Roles, and (for Union)
  grievance/case-management/worksite routes, and (for HOA)
  violations/maintenance/architectural-review routes — none of which exist.

## Dashboards

The existing `(portal)/dashboard/page.tsx` (previously the de facto
"Community" dashboard) now branches on vertical via `dashboardWidgets()`:

- **Community**: unchanged — every existing widget (fundraising/campaign
  progress, membership governance breakdown, payment-method breakdown,
  expenditures) still shows exactly as before.
- **Union / HOA**: the same underlying data (members, dues, upcoming
  events/meetings, recent activity), but campaign/governance/payment-method
  widgets are hidden rather than relabeled into something they aren't — "no
  fake metrics."
- **PTA**: has always had, and keeps, its own separate dashboard
  (`/labs/pta/dashboard`, `getPtaDashboardMetrics`). Visiting the generic
  `/dashboard` now redirects PTA-effective organizations there instead of
  showing Community wording.

Quick actions and a "Get Help" section (Phase 7/9) on the dashboard are
vertical-driven via `getQuickActions`/`getHelpTopics` — a PTA user's help
topics never mention Community fundraising; Union/HOA help never mentions
PTA households or students.

## Terminology

`getVerticalTerminology(vertical)` is the single source for customer-facing
words — `productLabel`, `member`/`memberPlural`, `officer`, `duesLabel`,
`meetingLabel`, `documentsLabel`, `dashboardTitle`, `dashboardWelcome`. It
never exposes internal terms (OrgMember, tenant, billing identity, ledger
entry, Prisma model names) — enforced by a dedicated test.

`PTA` is the internal enum value; every surface renders it as **"PTA / PTO"**
in customer-facing copy.

## Signup

The organization-creation wizard (`OrganizationOnboardingForm.tsx`, PR #35)
has a required, accessible (native `<fieldset>`/`radiogroup`) first step
using `VERTICAL_SELECTION_CARDS`. After creation, the API response includes
the persisted `primaryVertical`, and the client routes a PTA selection to
`/labs/pta/onboarding` (the existing, real PTA setup checklist) and
everything else to `/dashboard` (which already shows a "finish setup" banner
for a brand-new organization, and is itself vertical-aware per above).

## Mobile capability (Phase 10)

`GET /api/mobile/organizations` now returns an additive `capability` object
per organization row (`primaryVertical`, a compact `terminology` subset,
`quickActions`, `supportedModules` — which of the app's fixed tabs are
meaningful for this org — and `landingPage`). Nothing existing changed
shape; an old mobile build simply ignores the new field. No new mobile
screens were built — the existing fixed tab set (Home, Inbox, Announcements,
Payments, Events, Volunteer [PTA-only], Profile) is unchanged; this prepares
a future mobile release to consume vertical-aware labels/actions without
another endpoint change.

For efficiency, the endpoint never asks for a PTA Labs-access check twice —
rows already confirmed PTA-enrolled by the existing household-adult/officer
branches reuse that confirmation instead of re-querying.

## Known limitations

- Union and HOA have **zero dedicated business logic** — by design. They are
  navigation/dashboard/terminology relabels of the Community feature set.
  Real Union/HOA functionality (contract documents, dues nuances, board
  structures, assessments-vs-dues distinctions, etc.) is future work.
- No standalone, organization-wide document library exists for
  Community/Union/HOA (only PTA has one, via Labs). A future PR could
  generalize this.
- "Officers"/"Board" are just a relabeled `Users & Roles` page — there is no
  distinct officer/board data model yet.
- The dashboard's "finish setup" banner logic was left as Community's
  existing implementation, not generalized — Union/HOA reuse it as-is (it's
  already generic: profile completeness, member count, dues setup), and PTA
  keeps its own separate, richer setup checklist.
- Manual end-to-end verification for this PR covered the PTA experience
  fully (login, organization switch, nav, dashboard — all confirmed working
  live). Community/Union/HOA verification is by the automated test suite
  only (158 files / 1300+ tests, including dedicated navigation/terminology/
  resolver/dashboard-widget tests) — a second live verification pass was
  cut short after discovering the shared dev/production database has a low
  connection ceiling (see "Effective vs. raw vertical" above); continuing to
  reload the local dev server against it risked further destabilizing a
  shared resource. Recommend a live smoke test after this merges and
  deploys, when the app runs as a single long-lived process rather than a
  hot-reloading dev server.

## Future extension

The next vertical (Union, per the recommended follow-up PR) plugs in by:

1. Adding real Union routes/pages as they're built.
2. Updating `getNavigationProfile("UNION")` to point at them instead of the
   shared Community routes, one item at a time (no big-bang cutover needed —
   each item can move independently).
3. Updating `getVerticalTerminology`/`getQuickActions`/`getHelpTopics` for
   any newly-real Union-specific concepts (e.g., a real Steward role, real
   Contract Documents storage).
4. Extending `dashboardWidgets()`/the dashboard page with genuinely new Union
   widgets, gated the same way Community's are today.

No schema change, no new resolver, and no navigation-architecture change
should be needed to add a vertical this way — only new routes and new
entries in the existing per-vertical data modules.
