# HOA Permissions, Navigation, and Dashboard Proposal (PR #42 discovery)

Design only — no permissions, routes, or navigation code were added or
changed in this PR.

## Phase 5 — Permissions

### Key architectural recommendation: HOA should not fully replicate PTA's separate-surface pattern

PTA built an almost entirely separate page surface (`/labs/pta/*`) because
PTA households have a real structural mismatch with `OrgMember` (a
household-only parent may have no `OrgMember` row at all — see
`docs/pta-access-architecture.md`). HOA doesn't have that mismatch: per
`docs/hoa-domain-model.md`, every HOA resident (owner, tenant, family
member) is a full `OrgMember`. That means HOA can **reuse the existing
generic pages as-is** for everything that already maps cleanly — members
(residents), dues (assessments), events, meetings, communications, reports
— and only needs **new, dedicated pages for the genuinely new entities**:
Properties, Architectural Requests, Violations, Maintenance Requests.

This matters for permissions: it means most of HOA's day-to-day work
(managing the resident directory, billing assessments, scheduling board
meetings, sending announcements) needs **zero new permissions** — the
existing `members:*`, `dues:*`, `events:*`, `meetings:*`,
`communications:*`, `reports:*` already cover it, exactly as they already
do for Union today. New permissions are only needed for the four new
entities.

### Role mapping (reuses the existing `OrgRole` hierarchy — no new roles)

| HOA title | Maps to `OrgRole` | Why |
|---|---|---|
| Board President | `ORG_OWNER` | Same mapping PTA already uses for its President — full authority, ultimate legal/financial responsibility. |
| Board Member (general) | `ORG_ADMIN` | Broad governance authority short of ownership — settings, users, most operational areas. |
| Treasurer | `FINANCE` | Identical reasoning to PTA's Treasurer — dues/assessments, contributions, expenditures. |
| Secretary | `STAFF` | Identical reasoning to PTA's Secretary — meetings, minutes, communications, general operations. |
| Committee Chair (e.g. Architectural Review Committee chair) | `STAFF` + the specific new permission(s) for their committee's domain (e.g. `hoa:architectural:review`) | A chair needs decision authority in their one area without needing full `ORG_ADMIN` — achievable today via the existing per-org `OrgRolePermissionSet` customization (already used to let an org add/remove individual permissions per role), no new role needed. |
| Committee Member | `READ_ONLY` + the specific new read permission for their committee's area | Same mechanism as Committee Chair, read-only. |
| Property Manager (third-party professional management company) | `ORG_ADMIN` | Full day-to-day operational authority without being the legally-responsible owner role — the same distinction Union already needed between an officer and the org's ultimate owner. |
| Resident | `MEMBER` | Mobile/self-service only, zero staff permissions — identical to how a PTA parent maps to `MEMBER`. Self-service access is scoped by an ownership check (which property is this resident linked to), not by RBAC permissions, exactly like `requirePtaHouseholdSelfAccess()`. |
| Owner | Also `MEMBER` — **not a distinct role** | Ownership is a fact recorded on `PropertyResident.relationshipType`, not an access-control tier. An owner and a non-owner resident have the same self-service capabilities (view their property, submit requests) unless the association's own policy says otherwise, which is a business decision, not a platform permission. |
| Tenant | Also `MEMBER` — **not a distinct role** | Same reasoning as Owner. |
| **Guest** | **Should never exist as a role.** | No vertical in this codebase has ever needed a "logged in but barely anything" tier — an unauthenticated visitor simply has no account, and every real participant (owner, tenant, family member) already fits `MEMBER` or above. Inventing a Guest role would be a permission tier with no validated use case, exactly the kind of thing this audit is supposed to prevent. |

### New permissions (only for the four new entities — HOA-prefixed, matching PTA's naming convention)

| Permission | Grants |
|---|---|
| `hoa:properties:read` | View the property directory and individual property detail pages. |
| `hoa:properties:manage` | Create/edit/deactivate properties, manage `PropertyResident` links. |
| `hoa:architectural:read` | View architectural requests. |
| `hoa:architectural:review` | Approve/deny/condition an architectural request (distinct from read, so a Committee Member can be given read without decision authority). |
| `hoa:violations:read` | View violations. |
| `hoa:violations:manage` | Create/update violation status, send notices, resolve/waive. |
| `hoa:maintenance:read` | View maintenance requests. |
| `hoa:maintenance:manage` | Update status, assign, complete. |

No new permission is needed for assessments (reuses `dues:read`/
`dues:write`), the resident directory (reuses `members:read`/
`members:write`), board meetings (reuses `meetings:read`/`meetings:write`
+ the existing `meetings:minutes:review`/`meetings:minutes:approve`), or
announcements (reuses `communications:read`/`communications:write`).

### Default role → permission grants (proposed, for the default `ORG_ROLE_PERMISSIONS` map)

Following the exact precedent PTA set in `src/lib/rbac.ts`:

- `ORG_OWNER`/`SUPER_ADMIN`: everything (unchanged existing pattern — the
  "owner permissions" superset already includes every permission that
  exists).
- `ORG_ADMIN`: all four `*:manage` permissions plus all four `*:read`
  permissions — a Board Member or Property Manager can run every part of
  daily operations.
- `FINANCE`: no new permissions by default (Treasurer's job is
  assessments/dues, already covered by existing `dues:*`) — but an
  association is free to grant `hoa:violations:read` etc. via
  `OrgRolePermissionSet` if their Treasurer also tracks fine collection
  closely, without a platform change.
- `STAFF`: `hoa:properties:read`, `hoa:maintenance:read`,
  `hoa:maintenance:manage` (a Secretary/general staff role plausibly
  triages maintenance requests) — **not** `hoa:violations:manage` by
  default (compliance actions are more naturally board-level), and
  **not** `hoa:architectural:review` by default (also more naturally
  board/committee-level) — both grantable per-org via the existing
  override mechanism if an association wants staff to have it.
- `READ_ONLY`: `hoa:properties:read`, `hoa:architectural:read`,
  `hoa:violations:read`, `hoa:maintenance:read` — visibility without
  authority, matching the existing `READ_ONLY` philosophy everywhere else
  in this codebase.
- `MEMBER`: `[]`, unchanged — resident self-service is scoped by
  ownership/relationship checks, not RBAC permissions, exactly like PTA.

## Phase 6 — Navigation

### Recommendation: HOA graduates to its own navigation profile once these new pages exist (not before)

Today, HOA shares `sharedNavigation()` with Community and Union. That's
correct *today*, since HOA has no vertical-specific pages yet. Once the
four new entities ship, HOA needs its own distinct `NAVIGATION.HOA` list
(same architectural move PTA already made) — reusing shared items where
they apply, adding the new ones, and dropping the items that don't apply
to HOA (`Fundraising`/`Campaigns` has no real HOA equivalent — validated
in `docs/hoa-capability-audit.md` — and is currently shown anyway because
HOA hasn't graduated off the shared list yet; this is worth fixing
regardless of new-entity timing).

Proposed HOA navigation (MVP items only shown as MVP; see the MVP doc for
the phased release plan):

| Nav item | Route (proposed) | Status |
|---|---|---|
| HOA Dashboard | `/hoa/dashboard` (or keep generic `/dashboard`, vertical-branched — see Phase 7 recommendation) | **MVP** |
| Properties | `/hoa/properties` | **MVP** |
| Residents | `/members` (existing, relabeled "Residents") | **MVP** — reused, not new |
| Assessments | `/dues` (existing, relabeled "Assessments") | **MVP** — reused, not new |
| Violations | `/hoa/violations` | **MVP** |
| Architectural Requests | `/hoa/architectural` | **MVP** |
| Maintenance | `/hoa/maintenance` | **Nice to have / fast-follow** — see MVP doc |
| Amenities | `/hoa/amenities` | **Future** — deferred per the domain-model doc |
| Board | `/settings/users` (existing, relabeled "Board") | **MVP** — reused, not new |
| Committees | *(no existing model)* | **Future** — no committee model exists for any vertical except PTA's own `PtaCommittee`, which is PTA-specific; a generic committee concept is out of scope for this discovery and would need its own audit if ever pursued. For MVP, "committees" are just people with the right permission grants (Committee Chair/Member roles above), not a modeled entity. |
| Meetings | `/meetings` (existing, relabeled "Board Meetings") | **MVP** — reused, not new |
| Documents | `/settings/organization` (existing attachment surface, relabeled "Community Documents") | **MVP** — reused, not new |
| Reports | `/reports` (existing) | **MVP** — reused, not new |
| Settings | `/settings` (existing) | **MVP** — reused, not new |

Explicitly **not** carried over from the shared list once HOA graduates:
`Fundraising`/`Campaigns` (no HOA equivalent, per audit), `Expenditures`
nav item stays (it's genuinely useful for board budget tracking — HOA
associations track operating expenses same as anyone).

## Phase 7 — Dashboard

### Recommendation: extend the existing `dashboardWidgets()` per-vertical branch, not a separate HOA dashboard page

The current dashboard (`(portal)/dashboard/page.tsx`) already branches
widget visibility per vertical (`dashboardWidgets()` hides
fundraising/governance/payment-method widgets for Union/HOA). The
lowest-risk path is extending that same function with an HOA-specific
widget set, rather than building a parallel `/hoa/dashboard` page — this
keeps the "one dashboard, vertical-aware" architecture the rest of the
product already committed to, and avoids the exact kind of duplicated
surface this discovery is trying to minimize going forward.

### Proposed KPIs and widgets, by audience

**Board / Property Manager view** (full picture):
- Assessment collection rate (% of current-period `DuesCharge` rows paid) — reuses existing dues summary logic already computed for Community/Union.
- Outstanding assessments total (delinquent balance) — same underlying query as the existing "outstanding dues" metric.
- Open violations count, broken down by status (`OPEN`/`NOTICE_SENT`/`CURE_PERIOD`) — new widget, new query against `Violation`.
- Pending architectural requests count — new widget, new query against `ArchitecturalRequest`.
- Open maintenance requests count (if MVP includes it) — new widget.
- Upcoming board meetings — reuses existing meetings-list widget pattern.
- Recent announcements sent — reuses existing communications-log widget pattern.
- Operating budget vs. actual (Expenditure by Category) — reuses the existing expenditure summary Community already has, just newly surfaced for HOA (currently hidden per `dashboardWidgets()`).

**Resident/Owner view** (their own property only — this is a **new**
concept; today's dashboard has no "my own X" scoping for any vertical
except PTA's household-scoped parent dashboard):
- Their own assessment balance/status.
- Their own open violations (if any) — transparency without seeing
  others'.
- Their own architectural request status.
- Upcoming board meetings and recent announcements (same as everyone).

This resident-scoped view is structurally the same problem PTA already
solved (`requirePtaHouseholdSelfAccess()` + a household-scoped dashboard
section) — reuse that pattern (a `requireHoaPropertyResidentAccess()`
analog), not a new design.

**What's deliberately not shown as a KPI**: fundraising/campaign
progress (no HOA equivalent), membership-governance breakdown (a
Community-specific concept with no HOA parallel), payment-method
breakdown (real but low-priority — not worth dashboard real estate in an
MVP).
