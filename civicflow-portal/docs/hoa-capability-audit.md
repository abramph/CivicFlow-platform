# HOA Capability Audit (PR #42 discovery)

Discovery only — no schema, route, or code changes in this PR. See
`docs/hoa-domain-model.md`, `docs/hoa-capability-matrix.md`,
`docs/hoa-navigation-proposal.md`, `docs/hoa-mobile-strategy.md`, and
`docs/hoa-mvp-recommendation.md` for the rest of this discovery set.

## Phase 1 — What HOA/condo software actually does, ranked by how often it's used

This is drawn from the well-established HOA/condo/community-association
management software category (the space occupied by products like AppFolio
Community, Buildium, Vantaca, PayHOA, TownSq, CINC Systems) — deliberately
excluding rental-property management (tenant screening, lease management,
maintenance-for-landlords), which is a different product category with
different buyers.

Ranked by how consistently each capability appears across the category and
how often it's actually used day-to-day (not just listed as a feature):

| Rank | Capability | Why it's this high/low |
|---|---|---|
| 1 | **Resident/owner directory** | Every single product has this — it's the foundation everything else hangs off. |
| 2 | **Assessments & dues billing** (recurring + special assessments, late fees, payment collection) | The #1 reason boards buy this software at all — self-managed HOAs are drowning in spreadsheet-based collections. |
| 3 | **Announcements / mass communication** | Near-universal; boards communicate constantly (meeting notices, storm alerts, policy changes). |
| 4 | **Document library** (CC&Rs, bylaws, budgets, insurance certs, meeting minutes) | Universal — HOAs are document-heavy by legal necessity (governing documents, financial disclosures). |
| 5 | **Board/committee governance** (meetings, minutes, voting records) | Universal — boards are legally required to keep minutes in most states. |
| 6 | **Violation tracking & compliance** | Extremely common — this is a top-3 daily-use feature for self-managed and professionally-managed HOAs alike (lawn maintenance, parking, exterior modifications not yet approved). |
| 7 | **Architectural review requests** (ARC/ACC approval workflow) | Common in any HOA with exterior-modification restrictions (most single-family and townhome HOAs) — less relevant for high-rise condos. |
| 8 | **Maintenance/work order requests** | Common, especially condos and communities with shared amenities/common-area upkeep. |
| 9 | **Amenity reservations** (clubhouse, pool, tennis court, guest parking) | Common where amenities exist; not universal (many small HOAs have none). |
| 10 | **Vendor management** | Common in larger/professionally-managed associations; often just a document/contact list in smaller ones — rarely a dedicated module by itself. |
| 11 | **Owner portal / self-service payments** | Increasingly universal, but from the *product's* perspective this is really "assessments billing" + "documents" + "communications" wrapped in a resident-facing UI, not a separate capability. |
| 12 | **Board voting/elections** | Common at annual-meeting time; a distinct, lower-frequency workflow. |
| 13 | **Reserve fund / reserve study tracking** | Common in larger associations, often handled by a specialized reserve-study vendor product rather than the day-to-day HOA software; usually just a document + a budget line, not a dedicated module. |
| 14 | **Inspections** | Present in some products (drive-by compliance inspections), usually folded into violation tracking rather than standalone. |
| 15 | **Parking permits / vehicle registration** | Present in gated/urban communities; niche relative to the rest of this list. |
| 16 | **Pet registration** | Present in some products, low daily-use frequency; largely a compliance/violation-adjacent record. |
| 17 | **Owner-occupancy tracking** (owner-occupied vs. rented, for rental-cap enforcement) | Present in some products; a real HOA need (many CC&Rs cap the % of rented units) but narrow. |

**Frequency conclusion**: assessments/billing, communications, documents,
governance, and resident/owner directory are the load-bearing five —
present in 100% of real products and used constantly. Violations and
architectural requests are the next tier — present in the large majority of
products and used weekly/monthly. Maintenance requests and amenity
reservations matter specifically where an association has shared physical
assets. Everything below that (vendor management, elections, reserve
funds, inspections, parking, pets, occupancy) is real but lower-frequency
or narrower-audience.

## Phase 2 — What Unestra already has, mapped against every candidate capability

### Directly reusable (no code changes)

| HOA need | Reused as | Evidence |
|---|---|---|
| Announcements / mass communication | `CommunicationCampaign` + `CommunicationRecipient` + `CommunicationLog` | Same model every vertical already uses (`/communications`) — HOA already has this today. |
| Board meetings + minutes | `Meeting` + `MeetingMinutes` (approval workflow: DRAFT → IN_REVIEW → CHANGES_REQUESTED → APPROVED → SUPERSEDED) | `meetingType` is a free-text field — "Board Meeting" is just a value, not a schema change. Minutes approval already exists generically. |
| Document library | `Attachment` (`entityType: ORGANIZATION` or `OTHER`, polymorphic `entityId`) | Exactly how Union already stores CBA/contract documents (`docs/union-capability-audit.md`) — no HOA-specific model needed for simple file storage. |
| Events (community events, not amenity reservations) | `Event` | Already generic, already vertical-aware terminology. |
| Member/owner/resident directory | `OrgMember` | Already has address fields (`addressLine1/2`, `city`, `state`, `zipCode`, `county`), `householdName`, `memberNumber` — the exact fields an owner/resident record needs. |
| Push notifications, email | Existing `CommunicationCampaign` channels, mobile device tokens | Already vertical-agnostic. |
| Role-based permissions | `OrgRole` hierarchy (`MEMBER < READ_ONLY < STAFF < FINANCE < ORG_ADMIN < ORG_OWNER`) + per-org `OrgRolePermissionSet` overrides | Same mechanism PTA layered its own permissions onto — no new role enum needed. |
| Emergency alerts | `CommunicationCampaign` (existing channel set) | Not a new capability — an "emergency" announcement is just an announcement with urgent framing/copy, not a different delivery mechanism. |

### Reusable with terminology only (already done)

All of this is **already live** in `src/lib/vertical-terminology.ts` — confirmed by reading the file, not assumed:

| Generic term | HOA term |
|---|---|
| Dues | Assessments |
| Users & Roles | Board |
| Officer | Board Member |
| Member | Resident |
| Communications | Announcements |
| Documents | Community Documents |
| Meeting | Board Meeting |

Terminology, quick actions (`Invite Resident`, `Schedule Board Meeting`,
`Post Announcement`, `Upload Governing Document`), help topics, empty-state
copy, and the vertical-selection card are all already written and shipped —
this was completed as part of the vertical-experience-layer work, well
before this PR. Nothing further is needed here.

### Reusable with light enhancement

| HOA need | What exists | What's missing |
|---|---|---|
| Recurring + special assessments | `DuesAccount`/`DuesCharge`/`DuesPayment`/`DuesAdjustment` — already supports recurring charges with `periodStart`/`periodEnd`/`frequency`, adjustments, partial payments, void/correction trail | Nothing structural — a "special assessment" is just a one-off `DuesCharge` with no recurrence, already representable today. The only enhancement worth considering is a `Category`-level flag distinguishing "regular assessment" vs. "special assessment" for reporting, not a new charge type. |
| Budget categories | `Category` (`type: EXPENDITURE`) + `Expenditure` | Already fully generic; HOA operating-budget line items (landscaping, insurance, reserve contribution, management fees) are just `Category` rows like any other vertical's expense categories. No changes needed — this is a configuration exercise (seed data / onboarding checklist), not a feature. |
| Meeting packets (agenda + supporting docs bundled for a meeting) | `Meeting` + `Attachment` (`entityType: MEETING`) | The pieces exist; there's no "packet" grouping UI today (an officer would attach documents to a meeting one at a time). Worth a small enhancement in a later PR, not a new model. |
| Governing-document categorization (CC&Rs vs. bylaws vs. budget vs. insurance cert) | `Attachment.purpose` (free-text string) | Already supports this — `purpose` just needs an HOA-specific vocabulary (e.g. `"ccr"`, `"bylaws"`, `"budget"`, `"insurance_certificate"`), not a schema change. |

### Requires genuinely new domain concepts (validated, not assumed)

Evaluated every candidate the task listed. Conclusion for each, with
reasoning — see `docs/hoa-domain-model.md` for the full entity design of
the ones marked **new**:

| Candidate | Verdict | Reasoning |
|---|---|---|
| **Property** | **New — but see "Property vs. Unit" below.** | No existing model represents a physical address as a first-class, billable unit distinct from the owner's personal name/contact record. |
| **Unit** | **Folded into Property** (single-family) or **a distinct child of Property** (multi-unit condo) | See domain model doc — this is the one real structural decision this audit needed to make. |
| **Lot / Parcel** | **Not a new model** — same concept as "Property" for a single-family HOA (a lot *is* the property in that context) | Introducing a separate `Lot` model alongside `Property` would just be two names for the same row in the overwhelming majority of Unestra's realistic customer base (single-family HOAs, not large condo towers). |
| **Resident** | **Reuses `OrgMember`**, not new | `OrgMember` already supports a person with or without a login (`userId` nullable) — exactly what a non-owner resident (adult child, tenant in an owner-occupied-cap scenario) needs. |
| **Owner** | **Reuses `OrgMember`**, distinguished by a relationship to `Property`, not a separate model | An owner is a resident who additionally holds title — same person-record shape, different relationship. Modeling "Owner" as a distinct Prisma model from "Resident" would duplicate every contact field `OrgMember` already has. |
| **Tenant** | **Reuses `OrgMember`**, distinguished by relationship type | Same reasoning as Owner — a tenant is a resident with a specific occupancy relationship to a Property, not a structurally different kind of person record. |
| **Architectural Request** | **New** | No existing workflow model represents a submit → review → approve/deny/conditions lifecycle tied to a property. This is a real, validated gap — not present anywhere in Unestra today. |
| **Violation** | **New** | Same reasoning — no existing model represents a compliance issue with a lifecycle (reported → notice sent → cure period → resolved/escalated) tied to a property. |
| **Maintenance Request** | **New** | No existing "work order" concept. Structurally similar to Violation (a reported issue with a status lifecycle) but a different domain concern (member-initiated service request vs. board-initiated compliance action) — kept as a separate entity, not conflated. |
| **Reserve Fund** | **Not a new model** — a `Category` (`type: EXPENDITURE`, e.g. "Reserve Contribution") plus a document (the reserve study PDF via `Attachment`) | A dedicated reserve-fund *tracking* model (contribution schedule, funding-percentage calculations, component-level reserve study data) is a specialized, lower-frequency capability (see Phase 1 ranking) better deferred entirely — even most HOA software treats this as a document + a budget line, not a computed module. |
| **Vendor** | **Deferred, not built.** If built later: new, lightweight (name/contact/insurance-expiry/category) | Real need, but lower-frequency (Phase 1 rank 10) and, per most products' own experience, mostly a contact list. Not MVP. |
| **Amenity Reservation** | **New**, but structurally near-identical to the existing `PtaVolunteerSlot`/`PtaVolunteerSignup` pattern (capacity-limited, time-boxed slot + a member's signup against it) | Real gap, but only relevant to associations with shared amenities — not every HOA has a clubhouse or pool. |
| **Inspection** | **Not a new model** — an inspection *result* is just a `Violation` (or the absence of one); the inspection *event* itself is out of scope for MVP | Most products fold this into violations rather than a standalone module (Phase 1 finding). |
| **Parking Permit** | **Deferred, not built** | Niche (Phase 1 rank 15); would be a small new model if ever built (a permit record tied to a Property + a vehicle), but no evidence it's needed for a realistic first release. |
| **Vehicle** | **Deferred, not built** | Only relevant if Parking Permit is built; no standalone use otherwise. |
| **Pet Registration** | **Deferred, not built** | Niche (Phase 1 rank 16); if ever built, it's a small compliance-adjacent record, not core. |
| **Owner Occupancy** (owner-occupied vs. rented, for rental-cap enforcement) | **Not a new model** — a boolean/enum field on the Property↔Owner relationship (see domain model doc), not a standalone entity | Real need for associations with rental caps, but it's an attribute of an existing relationship, not a new concept requiring its own table. |

## Summary going into the domain-model design

Five genuinely new entities validated: **Property**, **PropertyOwner**
(the owner↔property relationship, since a property can have co-owners and
an owner can eventually own multiple properties), **ArchitecturalRequest**,
**Violation**, **MaintenanceRequest**. A sixth, **AmenityReservation**, is
validated but explicitly lower priority (only relevant to associations
with shared amenities) and modeled after the existing volunteer-slot
pattern rather than invented from scratch. Everything else on the
candidate list is either already fully solved by an existing model, solved
with light enhancement to an existing model, or deliberately deferred as a
real-but-lower-frequency capability. See `docs/hoa-domain-model.md` for the
full entity design.
