# Organization Vertical Lifecycle

How `Organization.primaryVertical` (COMMUNITY / PTA / UNION / HOA) is set,
why it's immutable in normal use, and the one controlled path to correct it.

## The mental model

```
User account
    ├── Membership in Riverdale Community Association   (vertical: COMMUNITY)
    ├── Membership in Pine Grove School PTA              (vertical: PTA)
    ├── Membership in United Workers Local 408           (vertical: UNION)
    └── Membership in Oak Ridge Homeowners Association   (vertical: HOA)
```

**The user chooses the organization. The organization determines the
vertical.** A user never chooses "Community mode" or "PTA mode" — those
words don't exist anywhere in the product. Selecting an organization (at
login, or via the switcher) is the only user-facing choice; the server
resolves that organization's vertical and builds the experience from it.

`primaryVertical` lives on `Organization`, never on `User` or
`OrganizationMembership`. A user with memberships in four organizations can
hold four different roles across four different verticals simultaneously —
nothing about the user record itself is vertical-specific.

## Lifecycle

1. **Set once, at creation.** Every new organization selects exactly one
   vertical during setup (`OrganizationOnboardingForm`, required field,
   validated server-side, persisted atomically with the rest of organization
   creation in one `prisma.organization.create` call — there is no window
   where an organization exists without a vertical). Recorded in the
   creation audit event.
2. **Fixed during normal use.** No organization-facing UI or API accepts
   `primaryVertical` as writable. `OrganizationSettingsForm` — the only
   place an ORG_OWNER/ORG_ADMIN can edit their organization's profile —
   never reads or writes it; Settings → Organization shows it read-only
   (see `docs/vertical-immutability.md`).
3. **Corrected only through Platform Admin**, for genuine setup/migration
   mistakes — see `docs/platform-admin-vertical-correction.md`.

## Why not user-level?

The task that introduced this model considered (and rejected) storing a
`selectedVertical`/`preferredVertical`/`platformMode` field on `User`. That
would imply a user has one overarching "mode" independent of which
organization they're looking at — false the moment a user belongs to two
organizations in different verticals. The only per-request "active vertical"
concept is `session.primaryVertical`, itself derived fresh from whichever
organization is currently active (see `resolveEffectiveVertical` in
`docs/vertical-experience-layer.md`) — never stored, never a user preference.

## Existing organizations (as of this document)

| Organization | Vertical | How it was determined |
|---|---|---|
| Pine Grove School PTA | PTA | Evidence-based backfill: PTA Labs enrolled + PtaProfile exists |
| Riverside Elementary PTA | PTA | Same |
| Riverdale Community Association | COMMUNITY | Safe default — no PTA evidence |
| APH Technologies, LLC (internal) | COMMUNITY | Safe default |
| Two early test-signup organizations | COMMUNITY | Safe default |

No organization has ever been auto-classified UNION or HOA — those verticals
require either explicit selection at signup or an explicit Platform Admin
correction; there is no automatic inference path for either.

## Related documents

- `docs/vertical-experience-layer.md` — the navigation/dashboard/terminology
  layer built on top of the vertical (PR #36)
- `docs/vertical-immutability.md` — exactly what ordinary users can and
  cannot do with this field
- `docs/platform-admin-vertical-correction.md` — the correction pathway
- `docs/multi-organization-users.md` — how one user spans multiple verticals
- `docs/mobile-organization-switching.md` — mobile-specific behavior
