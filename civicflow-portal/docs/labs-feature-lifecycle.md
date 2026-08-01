# Labs Feature Lifecycle

How a Labs feature moves from experimental to either a first-class product
or retirement, and what each `lifecycle` value actually enforces today.

## `lifecycle` values

Defined per-feature in `src/lib/labs/registry.ts`.

| Value | Enrollable? | Visible in org-facing Labs settings? | Notes |
|---|---|---|---|
| `ALPHA` | Yes (Platform Admin only, via Operations Center) | Yes, if already enrolled | Early, may change or break. |
| `BETA` | Yes | Yes | More stable, still not GA. |
| `GA` | Yes | Yes | Generally available Labs feature. |
| `RETIRED` | **No** | **No** | See below. |

## What `RETIRED` actually enforces (already existed before PR #40)

Two enforcement points already existed in `src/lib/labs/access.ts` before
this PR and needed no new code:

- **`listOrganizationLabAccess()`** filters out any feature whose
  `lifecycle === "RETIRED"` — it never appears in an organization's own
  Labs settings page (`/settings/labs`), regardless of any existing
  enrollment row.
- **`getOrganizationLabAccess()`** returns a `LAB_FEATURE_RETIRED` denial for
  any retired feature, for any organization, regardless of enrollment
  status.

PR #40 added one new enforcement point:

- **`setOrganizationLabEnrollment()`** (`src/lib/platform-operations/labs.ts`)
  now throws `LabEnrollmentValidationError` if a Platform Admin attempts to
  set a `RETIRED` feature's status to `ENABLED` or `PENDING` for any
  organization — retirement can no longer be reversed by a stray write.
- The Platform Admin "new Labs enrollment" form
  (`src/app/admin/platform/labs/page.tsx`) filters `RETIRED` features out of
  its feature-key picker, so there's no UI path to attempt it in the first
  place (the write-time guard above is the actual security boundary; the UI
  filter is a courtesy).

## What retirement deliberately does NOT do

- It does not delete `OrganizationLabFeature` rows. Existing rows for a
  retired feature remain in the database, readable via direct Prisma query
  or audit tooling, as historical record.
- It does not delete `AuditEvent` rows referencing the feature.
- It does not repurpose the feature key for a different feature. A retired
  key is retired permanently; a new experimental feature always gets a new,
  unique key.

## Retiring a feature: the checklist

1. Set `lifecycle: "RETIRED"` in the feature's registry entry
   (`src/lib/labs/registry.ts`).
2. Update the entry's `name`/`description`/`helpText` to say it's retired
   and point to wherever the successor behavior now lives (if any).
3. If the feature previously gated real functionality, make sure that
   functionality's access check no longer depends on
   `getOrganizationLabAccess`/`requireOrganizationLabFeature` for that key —
   retiring the registry entry only removes the *Labs* grant; any code still
   calling those functions with the retired key will simply always get
   denied, which is correct only if that's the intended end state.
4. Do not write a migration to touch existing `OrganizationLabFeature` rows
   — leave them as inert history.

## Worked example: `ptaVertical` (PR #40)

`ptaVertical` is the first feature retired under this lifecycle, and its
retirement is the concrete instance of the checklist above:

- `lifecycle: "RETIRED"`, description updated to point to
  `docs/pta-access-architecture.md`.
- PTA/PTO's actual access control was moved entirely off Labs and onto
  `Organization.primaryVertical` (see `docs/pta-access-architecture.md`) —
  so `ptaVertical` being retired doesn't remove PTA access, because nothing
  under the new architecture ever checked `ptaVertical` for access in the
  first place.
- Existing `ptaVertical` `OrganizationLabFeature` rows (from Pine Grove,
  Riverside, and any other previously-enrolled org) are untouched in the
  database.
