# Vertical Capability Matrix

What each `Organization.primaryVertical` value actually gets, as of PR #40.
See `docs/vertical-experience-layer.md` for the full navigation/terminology/
dashboard design history, and `docs/pta-access-architecture.md` for PTA's
access-control specifics.

## Access gate

| Vertical | Access gate | Labs enrollment required? |
|---|---|---|
| `COMMUNITY` | `primaryVertical === "COMMUNITY"` | No |
| `PTA` | `primaryVertical === "PTA"` + active org + valid officer/household relationship | **No** (as of PR #40 — previously required a separate `ptaVertical` Labs enrollment) |
| `UNION` | `primaryVertical === "UNION"` | No |
| `HOA` | `primaryVertical === "HOA"` | No |

No vertical's core access depends on Labs enrollment. Labs remains a
separate, optional axis for genuinely experimental features on top of any
vertical (e.g. Meeting Intelligence, Labs Framework Preview) — see
`docs/labs-feature-lifecycle.md`.

## Navigation, dashboard, terminology

| Capability | Community | PTA | Union | HOA |
|---|---|---|---|---|
| Dedicated navigation set | Shared (generic) | Distinct (`/labs/pta/*`) | Shared (generic, relabeled) | Shared (generic, relabeled) |
| Dedicated dashboard | Shared widgets | Distinct (`/labs/pta/dashboard`) | Shared data, campaign/governance widgets hidden | Shared data, campaign/governance widgets hidden |
| `/dues` label | Dues | (own page, not this route) | Union Dues | Assessments |
| `/settings/users` label | Users & Roles | (own officer model) | Officers | Board |
| `/communications` label | Communications | (own page) | Communications | Announcements |
| Standalone document library | No | Yes (`/labs/pta` namespace only) | No | No |
| Onboarding | Generic "finish setup" banner | Dedicated PTA setup checklist (`/labs/pta/onboarding`) | Generic banner | Generic banner |
| Mobile capability | `supportedModules` generic set | Generic set + Volunteer tab | Generic set | Generic set |
| Real dedicated business logic | Yes (existing product) | Yes | **None yet** — relabel of Community | **None yet** — relabel of Community |

## Signup

Every new organization selects a vertical at signup
(`VERTICAL_SELECTION_CARDS`). As of PR #40:

- **PTA** → `primaryVertical: "PTA"` is set at creation. No
  `OrganizationLabFeature` enrollment is created. Client routes to
  `/labs/pta/onboarding`, which loads immediately — no Platform Admin
  action required. See `docs/pta-onboarding.md`.
- **Community / Union / HOA** → routes to `/dashboard`, which shows a
  "finish setup" banner for a brand-new organization.

## Platform Admin correction

Any vertical can be corrected post-creation via Platform Admin →
Organizations → "Organization type correction"
(`docs/platform-admin-vertical-correction.md`). This writes exactly one
column (`Organization.primaryVertical`) and nothing else — no household,
membership, dues, subscription, or Labs-enrollment row is touched. Moving a
PTA organization's classification away and back is fully reversible; its
underlying data is dormant, never deleted.
