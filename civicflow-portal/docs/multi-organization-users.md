# Multi-Organization Users

A single user account can belong to organizations across different
verticals simultaneously — e.g., PTA president at Pine Grove, staff member
at a Community association, and a member of a Union local, all under one
login. This document covers what stays constant and what changes per
organization.

## What's per-user (constant across every organization)

- Identity: email, display name, password/MFA.
- Platform-wide access (`PlatformAccess`/`SUPER_ADMIN`), if any — entirely
  independent of any organization membership.

## What's per-organization-membership (changes when you switch)

- Role (`OrgRole` — can be different in every organization: ORG_OWNER in
  one, MEMBER in another).
- Effective permissions (derived from role + that organization's
  role-permission customizations).
- The organization's `primaryVertical`, and everything derived from it:
  navigation, dashboard, terminology, quick actions, help topics, landing
  page.

Nothing about vertical, terminology, or navigation is ever stored on the
`User` record — see `docs/organization-vertical-lifecycle.md` for why a
user-level `selectedVertical`/`platformMode` field was deliberately not
built.

## Login behavior

- **Zero organizations**: routed to invitation acceptance / organization
  creation / support, per existing product behavior — unchanged by this
  work.
- **Exactly one organization**: routed directly into it. No vertical-choice
  screen — the server resolves the vertical from that one organization and
  lands on the right dashboard.
- **More than one organization**: routed to the organization selector
  (`/select-organization`). Each entry shows the organization name; role and
  vertical badge are available context, not a separate choice.

## Switching

The organization switcher (`PortalShell`'s header dropdown) sends only
`organizationId` to `/api/organization/select` — never a vertical. The
server:

1. Validates the requesting user actually holds an active membership in that
   organization (a spoofed `organizationId` the user doesn't belong to
   returns 403 — verified by test).
2. Sets the active organization (cookie).
3. On the next session read, re-derives `primaryVertical`, permissions,
   entitlements, and Labs enrollment fresh from that organization's own
   database rows.
4. The client then re-renders navigation/dashboard/terminology from the
   refreshed session and redirects to that organization's landing route
   (`/labs/pta/dashboard` for PTA, `/dashboard` for everything else) rather
   than staying on whatever page was open — a page from the previous
   organization's vertical may not even exist in the new one.

No stale content persists across a switch: verified manually across all
four verticals in sequence (Community → Union → HOA → PTA → Community),
each transition showing only that organization's own nav/dashboard/
terminology.
