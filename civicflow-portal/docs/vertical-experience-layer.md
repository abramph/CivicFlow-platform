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

### Effective vs. raw vertical (superseded by PR #40 — see below)

> **PR #40 update:** the fallback described in this subsection no longer
> exists. `Organization.primaryVertical` is now the sole, authoritative gate
> for the PTA experience — `resolveEffectiveVertical(organizationId,
> primaryVertical)` returns `primaryVertical` unchanged, for every vertical,
> with no database lookup and no Labs check. A `PTA`-classified organization
> gets the full PTA navigation and dashboard immediately, with no Platform
> Admin enrollment step. See `docs/pta-access-architecture.md` for the
> current architecture. The history below is kept for context on why the
> "effective vertical" concept existed at all.

`Organization.primaryVertical` (the column) is the raw, stored,
Platform-Admin-controlled classification. Historically, PTA Labs enrollment
(`OrganizationLabFeature`, `featureKey: "ptaVertical"`) had **no self-service
path** — every enrollment row had `enrollmentSource: "operations_center"`,
meaning only a Platform Admin could turn it on. If an organization were
classified `PTA` but not (yet) enrolled, giving it PTA navigation and a PTA
dashboard redirect would point at pages that all said "not available for
this organization" — a dead end.

`resolveEffectiveVertical` used to close this gap by falling back to
`COMMUNITY` for a `PTA`-classified org until Labs enrollment existed. PR #40
removed this fallback entirely: it was the exact "contradictory state"
(an org correctly classified PTA, silently shown a different product) the
graduation work exists to eliminate. Now there is nothing to reconcile —
`primaryVertical` alone is the answer everywhere it's read.

**Where the (now-identity) resolution happens:**

- `authOptions.ts`'s session callback, `resolveOrganizationExperience()`,
  and `getUserOrgMemberships()` (`org-context.ts`) all read
  `primaryVertical` directly. There is no reconciliation query left to skip
  in the organization-switcher path — the earlier "switcher deliberately
  doesn't reconcile, for database-load reasons" split (previously
  documented here) no longer applies, since there is nothing left to
  reconcile.

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

As of PR #40, PTA inclusion in this endpoint's household-adult and officer
branches is decided directly from each organization's already-selected
`primaryVertical` field — no separate Labs-access query is made at all.

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
