# Vertical Immutability

What ordinary organization users can and cannot do with `primaryVertical`,
and how that's enforced (not just hidden in the UI).

## What's enforced, and where

| Actor | Can view? | Can edit? | Enforced by |
|---|---|---|---|
| ORG_OWNER | Yes (Settings → Organization, read-only) | No | No UI control exists; `/api/organization` (the settings update route) never accepts `primaryVertical` as a field |
| ORG_ADMIN | Yes | No | Same |
| STAFF / FINANCE / READ_ONLY | No (Settings → Organization requires `org_settings:read`) | No | Same, plus permission gate |
| MEMBER | No (no access to staff Settings at all) | No | Route-level guard |
| Platform Admin (SUPER_ADMIN `PlatformAccess`) | Yes, plus every organization's | Yes — via the controlled correction flow only | `requireSuperAdmin` on `/api/admin/organizations/[id]/primary-vertical` |

There is deliberately **no server-side "block this specific role" check**
for `primaryVertical` on the ordinary organization-settings API — the
stronger guarantee is that the field is never part of that API's accepted
input shape at all. A hidden/forged form field or a hand-crafted request to
`/api/organization` with a `primaryVertical` key is silently ignored (Zod's
schema for that route doesn't declare the field, so Prisma never sees it) —
verified by test.

The only write path is `changeOrganizationPrimaryVertical()`
(`src/lib/platform-operations/organizations.ts`), reachable exclusively
through the Platform Admin route, which:

- requires `requireSuperAdmin("throw")` — the same platform-wide guard used
  for every other Platform Admin action, independent of the actor's role in
  any specific organization
- requires a non-empty `reason` (rejects missing, empty, and
  whitespace-only)
- requires an explicit `confirm: true` flag — a stray or duplicate request
  without it is rejected rather than silently applied
- is a no-op (no write, no audit event) when the requested vertical already
  matches the current one

## What the client can never do

- **Spoof a vertical via the request body.** No route that mutates
  organization or session state accepts a client-supplied vertical that
  changes what gets stored or how permissions are evaluated. The signup
  route accepts `primaryVertical` only as part of *creating* a brand-new
  organization (and only the four enum values validate); every other route
  either doesn't accept it or requires Platform Admin authority to use it.
- **Change it by switching organizations.** `/api/organization/select`
  accepts only `organizationId`; the server looks up that organization's own
  stored vertical — a client cannot pair a valid `organizationId` with a
  vertical of its choosing.
- **Change it by replaying an old session.** `session.primaryVertical` is
  resolved fresh from the database on every session read (see
  `resolveEffectiveVertical` in `docs/vertical-experience-layer.md`), never
  cached in the signed JWT payload itself beyond what NextAuth's own session
  callback re-derives per request.

## What ordinary users see instead of an edit control

Settings → Organization shows:

```
Organization Type
[ PTA / PTO ]
This can't be changed here. Contact Unestra Support if it was set
incorrectly during setup.
```

No dropdown, no save button, no routine "change organization type" action
anywhere in ordinary organization settings.
