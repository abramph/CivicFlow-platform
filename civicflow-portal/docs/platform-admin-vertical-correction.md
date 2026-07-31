# Platform Admin: Organization Type Correction

The single, controlled path to change an organization's `primaryVertical`
after creation — for genuine setup mistakes, migration mistakes, or
pre-launch demo-organization corrections. Not a routine setting; uncommon
and operationally visible by design.

## Where

Platform Admin → Organizations → (an organization) → **"Organization type
correction"** section (`PrimaryVerticalManager` component). Deliberately not
labeled "Switch platform" or "Change vertical" — the section title and
description explicitly frame it as a correction, not routine configuration.

## Flow

1. **Select the proposed type** from a dropdown (Community / PTA-PTO / Union
   / HOA).
2. **Preview the impact** (`GET .../primary-vertical?to=<vertical>`,
   read-only, no write) — shows:
   - current vertical → proposed vertical
   - what becomes dormant (hidden, never deleted) — e.g. moving a PTA
     organization to Community lists its household/student counts that will
     no longer be reachable through PTA navigation
   - a warning if moving *to* PTA when PTA Labs isn't actually enrolled for
     that organization (see `resolveEffectiveVertical` in
     `docs/vertical-experience-layer.md` — this exact mismatch is what that
     function guards against elsewhere in the product)
3. **Enter a reason.** Required — the Confirm button stays disabled until
   non-empty, and the server independently rejects an empty or
   whitespace-only reason even if a client bypassed the UI.
4. **Confirm.** `PUT .../primary-vertical` with `{ newVertical, reason,
   confirm: true }`.

Requesting the organization's current vertical (no actual change) is a
no-op: no database write, no audit event, no error — this makes the
UI's disabled-until-different-selection behavior a genuine no-op rather than
merely a client-side courtesy.

## What is never touched

`changeOrganizationPrimaryVertical()` writes exactly one column
(`Organization.primaryVertical`) and nothing else:

- No PTA household, student, teacher, classroom, committee, dues, or
  volunteer-hour row is modified or deleted.
- No `OrganizationLabFeature` (Labs enrollment) row is modified — moving an
  organization *out* of PTA does not disable its PTA Labs enrollment, and
  moving one *into* PTA does not enable it. These are independent axes by
  design (see the `OrganizationVertical` doc comment in `schema.prisma`).
- No subscription/plan/billing field changes.
- No paid module activates.

Moving away from a vertical only changes which navigation/dashboard/
terminology the organization's users see going forward — its underlying
data is dormant, not gone, and reappears exactly as it was if the vertical
is corrected back (or, for PTA specifically, if Labs enrollment already
existed and simply wasn't reflected in the classification).

## Audit trail

Every real change (not the no-op case) writes an `AuditEvent`:

```
action: "organization.primary_vertical_changed"
entityType: "organization"
entityId: <organizationId>
metadata: { previousVertical, newVertical, reason }
actorUserId, actorEmail: the Platform Admin who made the change
```

Reviewable via Platform Admin → Audit Log, filtered by organization.

## Authorization

`requireSuperAdmin("throw")` — the same platform-wide guard used for every
other Platform Admin action. An ORG_OWNER or ORG_ADMIN of the target
organization (even with full control over their own organization's settings)
has no path to this endpoint; it's gated on `PlatformAccess`, which is
entirely independent of organization membership or role.
