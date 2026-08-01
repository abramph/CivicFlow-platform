# HOA Capability Matrix (PR #42 discovery)

One row per capability identified in `docs/hoa-capability-audit.md`,
classified into exactly one column. See that document and
`docs/hoa-domain-model.md` for the reasoning behind each classification.

| Capability | Reuse unchanged | Rename only | Small enhancement | New model | Future | Out of scope |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Resident/owner directory | | ✅ (Members → Residents) | | | | |
| Announcements / mass communication | ✅ | ✅ (label only) | | | | |
| Emergency alerts | ✅ (as urgent announcement) | | ✅ (priority flag, if ever pursued) | | | |
| Document library (general storage) | ✅ (`Attachment`) | ✅ (Documents → Community Documents) | ✅ (`purpose` vocabulary) | | | |
| Board/committee governance (meetings + minutes) | ✅ (`Meeting`/`MeetingMinutes`) | ✅ (Meeting → Board Meeting) | | | | |
| Meeting packets (bundled agenda + docs) | | | ✅ | | | |
| Recurring assessments | ✅ (`DuesAccount`/`DuesCharge`/`DuesPayment`) | ✅ (Dues → Assessments) | | | | |
| Special (one-off) assessments | ✅ (`DuesCharge` with no recurrence) | ✅ | | | | |
| Violation fines | ✅ (`DuesCharge` + `Category`) | | ✅ (cross-reference from `Violation`) | | | |
| Operating budget / expense categories | ✅ (`Category` type EXPENDITURE, `Expenditure`) | | | | | |
| Events (community events) | ✅ | | | | | |
| Role-based permissions (board roles) | ✅ (`OrgRole` hierarchy + `OrgRolePermissionSet`) | ✅ (Officer → Board Member) | | | | |
| Push notifications / email | ✅ | | | | | |
| Property/unit/lot records | | | | ✅ `Property` | | |
| Owner records | ✅ (`OrgMember`) | | | ✅ `PropertyResident` (relationship) | | |
| Tenant records | ✅ (`OrgMember`) | | | ✅ `PropertyResident` (relationship) | | |
| Owner-occupancy tracking (rental-cap enforcement) | | | ✅ (attribute on `PropertyResident`) | | | |
| Architectural review requests | | | | ✅ `ArchitecturalRequest` | | |
| Violation tracking & compliance | | | | ✅ `Violation` | | |
| Maintenance / work order requests | | | | ✅ `MaintenanceRequest` | | |
| Amenity reservations | | | | ✅ `Amenity` + `AmenityReservation` | ✅ (deferred past MVP) | |
| Reserve fund / reserve study tracking | ✅ (`Category` + `Attachment`) | | | | | |
| Vendor management | | | | (small, if built) | ✅ | |
| Board voting / elections | | | | (not designed — no validated MVP demand) | ✅ | |
| Inspections (standalone) | ✅ (folds into `Violation`) | | | | | |
| Parking permits | | | | (small, if built) | ✅ | |
| Vehicle registration | | | | (small, if built) | ✅ | |
| Pet registration | | | | (small, if built) | ✅ | |
| Owner portal / self-service payments | ✅ (existing member-portal payment flow) | | | | | |
| Mobile: pay assessments | ✅ (already works) | | | | | |
| Mobile: announcements | ✅ (already works) | | | | | |
| Mobile: view own violations | | | ✅ (new read-only view) | | | |
| Mobile: submit maintenance requests | | | | | ✅ | |
| Mobile: architectural request submission | | | | | ✅ | |
| Mobile: architectural approval (board decision) | | | | | | ✅ (never on mobile — board-level decision) |
| Mobile: amenity reservations | | | | | ✅ | |
| Mobile: document upload (resident-facing) | | | | | | ✅ |
| Rental-property management (screening, leases) | | | | | | ✅ (different product category entirely, per Phase 1 scope note) |
