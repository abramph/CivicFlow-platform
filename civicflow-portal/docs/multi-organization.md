# Multi-organization membership

One CivicFlow login (`User`) can belong to more than one organization —
Admin at one, Member at another, Treasurer at a third. This doc explains how
that's modeled, how the "active" organization is picked for a given request,
and how to add a new org-scoped feature without leaking data across orgs.

## Data model

Nothing here is new — multi-org already existed at the data layer before the
session-selection work described below. Two join tables carry it:

- **`OrganizationMembership`** (`userId` + `organizationId`, unique pair) —
  the staff-side relationship. Carries `role` (`OrgRole`) and `status`
  (`active` | `suspended`). One row per role per org; a user can hold
  different roles in different orgs by having multiple rows.
- **`OrgMember`** — the per-org constituent record (dues, payments, address,
  comms preferences, SMS consent). Optionally linked to a `User` via
  `userId` when that member also has a login. A user can have an `OrgMember`
  row in some orgs and not others (e.g. staff-only in Org A, a dues-paying
  member in Org B).

A single user can therefore have an `OrganizationMembership` with role
`ORG_ADMIN` in Org A, another with role `MEMBER` in Org B (plus a matching
`OrgMember` row in B for their dues/payments), and no relationship at all
with Org C. All existing org-scoped tables (`DuesCharge`, `Contribution`,
`Event`, `CommunicationRecipient`, ...) are already scoped by
`organizationId` (or transitively via `OrgMember`/`memberId`) — that part
required no changes.

## Picking the active organization

`src/lib/org-context.ts` is the single source of truth:

- **`getUserOrgMemberships(userId)`** — every org the user actively belongs
  to (excludes `suspended` `OrganizationMembership` rows and orgs whose own
  `status` isn't `active`), oldest membership first. Left-joins `OrgMember`
  so each entry carries `memberId`/`memberStatus` when a constituent record
  exists in that org.
- **`resolveActiveOrganization(userId, requestedOrgId?)`** — picks one:
  1. `requestedOrgId` if it's a real membership,
  2. else the `cf_active_org` cookie value if it's a real membership,
  3. else the oldest membership,
  4. `null` only if the user has zero active memberships.

Both functions **never trust a client-supplied id blindly** — every
candidate is checked against the real `OrganizationMembership` rows before
being returned.

`authOptions.ts`'s `session()` callback calls `resolveActiveOrganization`
fresh on every request (never frozen in the JWT) and populates:

- `session.organizationId` / `session.orgName` / `session.role` — the
  active org, same fields every existing guard already reads.
- `session.memberId` — the active org's `OrgMember.id`, if one exists.
- `session.organizations` — the full list, for switcher UI.

Because this lives in the session callback, **every existing
`requireOrganization()` / `requirePermission()` / `requireRole()`-gated
route respects the selected org automatically** — no per-route changes were
needed to ship this.

## The `cf_active_org` cookie

Set by `POST /api/organization/select` (validates `organizationId` against
`getUserOrgMemberships` first, 403s otherwise) — the canonical switch
endpoint for both staff and member surfaces.
`POST /api/member-portal/select-organization` is kept as a thin legacy
alias (mobile app, old bookmarks) that delegates to the same check and sets
both the unified cookie and the older `cf_member_org` cookie.

`src/lib/member-web-session.ts`'s `getMemberWebSession()` (used by every
`/m/*` server page) also reads `cf_active_org` first, falling back to the
legacy `cf_member_org` cookie for cookies set before unification. It further
filters to `role: "MEMBER"` memberships — `/m/*` is member-facing only, so a
user's staff-role orgs never appear there.

## UI entry points

- **`/select-organization`** — post-login landing page (`requireAuth()`
  only, not `requireOrganization()`, since its job is picking one). Zero
  memberships → friendly empty state; exactly one → redirects straight
  through (no cookie write needed — `resolveActiveOrganization`'s
  "oldest membership" fallback already resolves it); two or more → a picker,
  each row routing to `/m/dues` (role `MEMBER`) or `/dashboard` (anything
  else) after selection.
- **Staff switcher** — a dropdown in `PortalShell.tsx`'s header, shown only
  when `session.organizations.length > 1`. Posts to
  `/api/organization/select`, calls `useSession().update()` to refresh the
  client session, then navigates to `/m/dues` or refreshes in place
  depending on the new org's role.
- **Member switcher** — the existing drawer in `MemberPortalShell.tsx`,
  refactored to source its option list from `useSession().session.organizations`
  (filtered to `role === "MEMBER"`) instead of a dedicated fetch, and to post
  to the unified endpoint.
- **`/m/all-organizations`** — cross-org member view, shown in the member
  nav only when the member has 2+ `MEMBER`-role memberships. Runs the same
  queries `/m/dues`, `/m/events`, `/m/announcements` use today, across every
  org's `memberId` in parallel, each row tagged with an org badge.

## Adding a new org-scoped feature

- Always derive `organizationId` from `requireOrganization()` /
  `requirePermission()` / `requireRole()` — never from a client-supplied
  value (query param, request body, header).
- If the route needs the active org's `OrgMember.id`, prefer
  `session.memberId` over a fresh lookup — it's already resolved.
- If the feature is a `/m/*` page that supports a `?org=` deep-link override
  (from a push notification or email), use `getMemberWebSession(org)`
  instead of `session.memberId` directly — the session-level value doesn't
  know about the per-request query override.
- `requireSuperAdmin()` is unaffected by any of this — it's a role-rank
  check only, not org-scoped, so `/admin/platform/*` access doesn't depend
  on which org is currently selected.
