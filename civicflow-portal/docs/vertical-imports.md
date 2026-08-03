# Vertical-Specific Data Import (PR #44)

Coverage of the CSV/Excel/SQLite Import Data page (`/import`, `src/app/api/import/route.ts`) as of PR #44, and what's covered elsewhere.

## Import support by vertical

| Vertical | Import path | Status |
| --- | --- | --- |
| Community | Members, Contributions (`/import`) | Pre-existing |
| Union | Payroll-checkoff dues (`/payments/imports`, `PaymentImportBatch`/`PaymentImportSourceType.PAYROLL_CHECKOFF`) | Pre-existing, separate pipeline |
| PTA | Households + primary contact + students (`/import`, type `pta-households`) | Added in PR #44 |
| HOA | Properties + owner/resident (`/import`, type `hoa-properties`) | Added in PR #44 |

The Electron desktop-migration importer (`/migration`, `src/lib/migration-import.ts`) was deliberately **not** extended with vertical-specific entities — the desktop app has no vertical concept at all, so no real desktop export could ever contain PTA household or HOA property data.

## PTA households (`importPtaHouseholds`, `src/lib/vertical-import.ts`)

One CSV row = one household + its primary contact adult, optionally with students (semicolon- or comma-separated in one column).

Required columns: Household Name, School Year, Primary Contact Name.
Optional: Primary Contact Email, Primary Contact Phone, Student Names, Notes.

**Idempotency**: matched by `(organizationId, displayName, schoolYear)`. A household that already has a primary contact is skipped entirely on re-import. A household that exists but is missing a primary contact (e.g. from a prior partial failure — see below) has its contact/student steps retried against the existing row rather than being treated as a duplicate.

**Partial-failure behavior**: `createPtaHousehold`, `addPtaHouseholdAdult`, and `addPtaStudent` are separate, non-transactional calls (the same service-layer functions the officer UI uses). A failure between steps can leave a household with no primary contact — the importer detects and recovers from this state on re-import rather than silently reporting success forever. Student additions are idempotent per name to avoid duplicating a student that was already added before a partial failure.

**Not supported**: two contacts per row (only one primary contact field exists — a second adult can be added afterward through the officer UI), grade/classroom/teacher academic relationships (separate PTA entities, out of scope).

## HOA properties (`importHoaProperties`, `src/lib/vertical-import.ts`)

One CSV row = one property, optionally with one owner/resident.

Required column: Street Address.
Optional: Address Line 2, Unit/Lot Number, Building, City, State, ZIP, Property Type, Owner First/Last Name, Owner Email, Relationship Type, Notes (board-only).

**Idempotency**: properties matched by `(organizationId, addressLine1, unitLabel)` — Property has no unique DB constraint on address, so this is an application-level check (same pattern as the desktop importer uses for Event/Meeting). Owner/resident links are matched by an existing `ACTIVE` `PropertyResident` row before re-assigning, so re-importing the same file never duplicates a relationship.

**Multiple residents on one property**: supported by giving two rows the same address — the property is created once (first row) and matched (subsequent rows), each row's owner is linked independently.

**Owners are always a real `OrgMember`**, matched by email or created fresh — never a lighter-weight record — matching the architecture decision documented in `docs/hoa-domain-model.md`. A new owner counts against the organization's plan member limit exactly as manually adding one would; if the limit is reached mid-import, the property is still created but that row's owner-link is reported as a per-row error (upgrade the plan and re-run to link the rest).

**Cross-tenant safety**: an owner email that already belongs to a member in a *different* organization is never reused — a fresh `OrgMember` is created scoped to the importing organization.

## Authorization

Both new import types are gated by the same vertical-aware guards the rest of the app uses (`requirePtaAccess`, `requireHoaPropertyWrite` + `requireHoaResidentWrite`) — not just an RBAC permission string. A Community or Union org whose STAFF role happens to technically hold `pta:households:manage` (permissions aren't vertical-scoped) still cannot use this to create PTA data, because the guard also checks the organization's actual `primaryVertical`.

## Known limitations

- Neither the vertical importers nor the pre-existing generic Members importer validate email format — malformed values are stored as-is. This is consistent, pre-existing behavior across the whole import system, not a new gap.
- Mappings are never persisted — every upload rebuilds its column mapping from scratch (auto-detected via header aliases, or set manually). There is no backward-compatibility concern from the mapping-direction fix below, since nothing is saved across sessions.

## See also

[`import-column-mapping.md`](./import-column-mapping.md) for the column-mapping bug found and fixed alongside this work.
