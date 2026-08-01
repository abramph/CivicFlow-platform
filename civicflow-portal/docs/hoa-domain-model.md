# HOA Domain Model (PR #42 discovery)

Design only — **no Prisma models were created or modified**. This is the
proposed shape for a future implementation PR. See
`docs/hoa-capability-audit.md` for how each entity below was validated as a
genuine gap (not assumed).

## Phase 4 — The one real structural decision: Property vs. Unit

The task asked whether the hierarchy should be `HOA → Property → Unit →
Owner → Resident → Assessment → Payment`, or something flatter.

**Recommendation: flatten `Property` and `Unit` into one entity.**

Reasoning:

- Unestra's realistic HOA customer base skews toward single-family and
  townhome associations (neighborhood associations), where "the property"
  and "the unit" are the same physical/billable thing — there is no
  meaningful parent-child relationship to model. Forcing a `Unit` that
  always has exactly one `Property` parent in that case is pure ceremony:
  every write doubles up, every query joins through a level that adds no
  information.
- For a condo/multi-unit building, the pattern that actually matters is
  optional *grouping* (which units share a building/entrance/floor), not a
  required ownership hierarchy. That's a light attribute (`buildingLabel:
  String?`) on `Property`, not a second table.
- This mirrors a decision already made and proven elsewhere in this
  codebase: the audit explicitly rejected a separate `Lot` model for the
  same reason (`docs/hoa-capability-audit.md`) — one billable/addressable
  row per home, not two names for the same row.
- It also mirrors `PtaHousehold`: one row per billable unit, not a
  `Family → Household` hierarchy that would add nothing for the common
  case and only complicate the uncommon one.

So: **`Property` is the single billable, addressable unit** — whether
that's a single-family lot or one condo unit in a building. Everything
below hangs off `Property` directly.

```text
Organization (existing)
 └─ Property (new)                     — one row per address/lot/unit
     ├─ PropertyResident (new, join)   — links Property ↔ OrgMember, carries relationship type
     │   └─ OrgMember (existing)       — the actual person: owner, tenant, or family member
     ├─ DuesAccount (existing, reused) — "Assessments" for this property, billed to its OrgMember
     │   └─ DuesCharge → DuesPayment (existing, reused)
     ├─ ArchitecturalRequest (new)
     ├─ Violation (new)
     └─ MaintenanceRequest (new)

Organization (existing)
 └─ Amenity (new)                      — the reservable resource itself (clubhouse, pool, court)
     └─ AmenityReservation (new)       — a specific booking, tied to a Property/OrgMember
```

Answering the task's specific question directly: **Properties do not "own"
Units** (they're the same thing, per above). **Properties are linked to
Owners/Residents via a join table** (`PropertyResident`), not an ownership
chain — because a property can have co-owners, an owner can eventually own
more than one property in the same association (not rare — investors,
family members buying a second unit), and a non-owner resident (adult
child, tenant) needs to be represented without pretending they "own" the
relationship. **Owners do not "own" Residents** — ownership and residency
are two independent facts about the same `Property ↔ OrgMember`
relationship, which is exactly why they're modeled as one join table with
a `relationshipType` field rather than a parent-child chain.

### Why residents/owners reuse `OrgMember` directly (not a new "Resident" table, and not copying PTA's household-adult pattern verbatim)

PTA's `PtaHouseholdAdult` deliberately does **not** require an
`OrgMember` row — a household-only parent can exist with just a `userId`
link, because PTA dues are billed at the household level and an
individual parent's own membership profile is often unnecessary overhead.

HOA doesn't have that same asymmetry: assessments are billed per-property,
but every person with a real relationship to a property (owner, tenant,
adult family member) already benefits from the full `OrgMember` shape
Unestra Core provides for free — address fields, communications
preferences, SMS consent, dues relationships, attendance, timeline. There
is no HOA-specific reason to invent a lighter parallel person-record the
way PTA needed to. So: **every HOA resident is an `OrgMember`**, and
`PropertyResident` is purely a relationship/join row (which property, what
kind of relationship, since when) — not a second copy of contact fields.

## Phase 3 — Proposed entities

### `Property`

| | |
|---|---|
| **Purpose** | The billable, addressable unit an association governs — a lot, a townhome, or a condo unit. |
| **Key fields** | `organizationId`, `addressLine1/2`, `city`, `state`, `zipCode`, `unitLabel` (String?, e.g. "Unit 4B" or "Lot 12"), `buildingLabel` (String?, optional grouping for condos), `propertyTypeId` (FK to existing `Category`, `type: "PROPERTY"` — reuses the same classification mechanism every other vertical uses for its own type/category needs), `billingMemberId` (String?, FK to `OrgMember` — who receives assessment charges; mirrors `PtaHousehold.orgMemberId`), `status` (ACTIVE / INACTIVE — an inactive property is one no longer part of the association, e.g. de-annexed, not "vacant"), `notes`. |
| **Relationships** | Belongs to `Organization`. Has many `PropertyResident`. Optionally linked to one billing `OrgMember`. Has many `ArchitecturalRequest`, `Violation`, `MaintenanceRequest`. |
| **Ownership** | Association staff (Board/Property Manager roles) create and maintain; a resident never creates their own `Property` row (mirrors how a PTA parent never creates their own household). |
| **Lifecycle** | Created at onboarding (bulk import or manual entry) or when a new home is added to the association; status flips to `INACTIVE` on de-annexation — never hard-deleted, matching every other tenant-scoped model's soft-lifecycle convention in this codebase. |
| **Tenant isolation** | `organizationId` on every row, same pattern as every existing model. |
| **Authorization** | Read: any authenticated resident of that org can see the directory (subject to a "residents can see their own property, board sees all" rule — see Phase 5). Write: board/property-manager roles only. |
| **Expected size** | Small — a self-managed HOA is typically 20-500 properties; even a large managed association rarely exceeds a few thousand. |
| **Expected volume** | Very low write volume (properties are added/changed rarely — this is closer to `Organization` itself in volatility than to `DuesCharge`). |
| **MVP** | **Yes** — the foundational entity everything else depends on. |

### `PropertyResident`

| | |
|---|---|
| **Purpose** | The relationship between a `Property` and the `OrgMember`(s) connected to it — who owns it, who lives there. |
| **Key fields** | `organizationId`, `propertyId`, `orgMemberId`, `relationshipType` (enum: `OWNER`, `TENANT`, `FAMILY_MEMBER`, `OTHER`), `isPrimaryContact` (Boolean), `moveInDate`/`moveOutDate` (DateTime?), `ownershipPercentage` (Decimal?, nullable — only meaningful for co-owners, not required for MVP). |
| **Relationships** | Belongs to `Property` and `OrgMember`. |
| **Ownership** | Board/property-manager maintained. |
| **Lifecycle** | Created when a resident moves in or an owner is recorded; `moveOutDate` set rather than deleted, preserving history (who lived here, when) for governance/legal reasons — HOAs routinely need this for rental-cap enforcement and dispute history. |
| **Tenant isolation** | `organizationId` on the row (denormalized from `Property`, matching the rest of this codebase's convention of not making every join require a second-level lookup for tenant scoping). |
| **Authorization** | Same as `Property` — board manages; a resident can see their own relationships, not another property's. |
| **Expected size** | Roughly 1-3x the property count (most properties have 1-2 residents; some have more). |
| **Expected volume** | Low write volume, similar to `Property`. |
| **MVP** | **Yes** — without this, `Property` has no way to express who lives there. |

### `ArchitecturalRequest`

| | |
|---|---|
| **Purpose** | A resident's submission for board/committee approval of an exterior modification (paint color, fence, addition, landscaping change), and its review lifecycle. |
| **Key fields** | `organizationId`, `propertyId`, `submittedByMemberId` (FK `OrgMember`), `category` (free-text or small enum: fence/paint/landscaping/addition/roofing/other — kept free-text initially, matching `Meeting.meetingType`'s precedent of not over-enumerating early), `title`, `description`, `status` (enum: `SUBMITTED`, `IN_REVIEW`, `APPROVED`, `APPROVED_WITH_CONDITIONS`, `DENIED`, `WITHDRAWN`), `decisionNotes` (String?), `conditions` (String?, only when approved-with-conditions), `reviewedByUserId`, `reviewedAt`, `submittedAt`. |
| **Relationships** | Belongs to `Property`; supporting documents (photos, plans) via existing `Attachment` (`entityType: OTHER` today, or a new `ARCHITECTURAL_REQUEST` enum value if the volume justifies a dedicated filter later — not required for MVP). |
| **Ownership** | Submitted by a resident (self-service); reviewed/decided by board/ARC-committee roles. |
| **Lifecycle** | `SUBMITTED` → `IN_REVIEW` → one of `APPROVED` / `APPROVED_WITH_CONDITIONS` / `DENIED`, or `WITHDRAWN` by the submitter before a decision — a linear workflow, no reopening (a denied request that's resubmitted is a new row, preserving history, matching `DuesCharge`'s correction-creates-new-revision convention). |
| **Tenant isolation** | `organizationId` on every row. |
| **Authorization** | A resident can create and read their own; board/ARC roles can read all and decide. New permission needed — see Phase 5. |
| **Expected size** | Low — most associations process a handful to a few dozen per year. |
| **Expected volume** | Low write volume; occasional read spikes around annual "improve your home" seasons (spring). |
| **MVP** | **Yes** — validated as a real, common, currently-unmet need (Phase 1/2 audit). |

### `Violation`

| | |
|---|---|
| **Purpose** | A recorded compliance issue (lawn maintenance, unapproved exterior change, parking, trash, noise) and its resolution lifecycle. |
| **Key fields** | `organizationId`, `propertyId`, `reportedByUserId`, `violationType` (free-text, same reasoning as `ArchitecturalRequest.category`), `description`, `status` (enum: `OPEN`, `NOTICE_SENT`, `CURE_PERIOD`, `RESOLVED`, `ESCALATED`, `WAIVED`), `noticeSentAt`, `cureByDate`, `resolvedAt`, `resolutionNotes`, `fineChargeId` (String?, FK to `DuesCharge` — see below). |
| **Relationships** | Belongs to `Property`; supporting photos via existing `Attachment`; optionally linked to a `DuesCharge` if the violation carries a fine. |
| **Ownership** | Board/property-manager created and managed; never resident-initiated (distinguishes it from `MaintenanceRequest`, which is). |
| **Lifecycle** | `OPEN` → `NOTICE_SENT` → `CURE_PERIOD` → `RESOLVED` (or `ESCALATED` for repeat/unresolved, or `WAIVED` at board discretion) — a real governance record, kept indefinitely (never deleted), matching `MeetingMinutes`'s "a governance document must not be silently destroyed" convention (`onDelete: Restrict`, not `Cascade`, on the property relation would be worth considering in implementation). |
| **Tenant isolation** | `organizationId` on every row. |
| **Authorization** | Board/compliance roles only — a resident should see violations *against their own property* (transparency) but never another resident's, and never create one. |
| **Expected size** | Varies widely by association; typically low-to-moderate (tens to low hundreds/year for an active association). |
| **Expected volume** | Low-to-moderate write volume; can spike seasonally (landscaping violations in growing season). |
| **MVP** | **Yes** — validated as a top-tier, frequently-used capability (Phase 1 ranking: #6). |

**Fines**: rather than inventing a parallel payment model, a violation
fine is proposed as an ordinary `DuesCharge` (same model assessments
already use), tagged via a `Category` (`type: DUES`, e.g. "Violation
Fine") and cross-referenced from `Violation.fineChargeId` — reusing the
entire existing billing/payment/adjustment/void pipeline rather than
building a second one.

### `MaintenanceRequest`

| | |
|---|---|
| **Purpose** | A resident-submitted service/work-order request (plumbing, common-area upkeep, broken amenity) and its handling lifecycle. |
| **Key fields** | `organizationId`, `propertyId` (nullable — a common-area request like "clubhouse light out" has no specific property), `submittedByMemberId`, `category` (free-text), `title`, `description`, `status` (enum: `SUBMITTED`, `ACKNOWLEDGED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`), `assignedToUserId` (String?, staff), `completedAt`, `resolutionNotes`. |
| **Relationships** | Optionally belongs to `Property`; photos via existing `Attachment`. |
| **Ownership** | Resident-submitted (self-service); board/property-manager/maintenance-staff-role managed. |
| **Lifecycle** | Linear: `SUBMITTED` → `ACKNOWLEDGED` → `IN_PROGRESS` → `COMPLETED`, or `CANCELLED` at any point before completion. |
| **Tenant isolation** | `organizationId` on every row. |
| **Authorization** | A resident can create and read their own; board/property-manager can read/manage all. Deliberately a **separate model from `Violation`**, not a shared "issue" model with a type flag — the two have inverted authorization (resident-initiated vs. board-initiated) and different audiences, and conflating them would force awkward permission logic onto a single table. |
| **Expected size** | Low-to-moderate, similar order of magnitude to `Violation`. |
| **Expected volume** | Similar to `Violation`. |
| **MVP** | **Nice to have** — real and validated, but ranked below Violation/Architectural Request in the Phase 1 frequency analysis, and structurally the *lowest-risk to add in a fast-follow* since it doesn't touch billing at all. See MVP recommendation for the full reasoning. |

### `Amenity` and `AmenityReservation`

| | |
|---|---|
| **Purpose** | `Amenity` — the reservable shared resource itself (clubhouse, pool, tennis court, guest parking spot). `AmenityReservation` — a specific time-boxed booking against it. |
| **Key fields (`Amenity`)** | `organizationId`, `name`, `description`, `requiresApproval` (Boolean), `maxDurationMinutes` (Int?), `capacityPerSlot` (Int, default 1 — allows a shared-use amenity like a picnic pavilion to permit concurrent, non-exclusive bookings if ever needed), `isActive`. |
| **Key fields (`AmenityReservation`)** | `organizationId`, `amenityId`, `propertyId`, `requestedByMemberId`, `startAt`, `endAt`, `status` (enum: `REQUESTED`, `APPROVED`, `DENIED`, `CANCELLED`), `notes`. |
| **Relationships** | `AmenityReservation` belongs to `Amenity` and `Property`. |
| **Ownership** | `Amenity` catalog is board-managed; reservations are resident-initiated (self-service), approved automatically or by staff depending on `requiresApproval`. |
| **Lifecycle** | This is structurally the same shape as the existing `PtaVolunteerOpportunity` → `PtaVolunteerSlot` → `PtaVolunteerSignup` pattern (a reservable resource, time-boxed availability, and a claim against it) — reusing a proven pattern rather than inventing a new one, simplified to two tables instead of three since amenities don't need PTA's separate "opportunity vs. slot" split (an amenity *is* its own slot generator). |
| **Tenant isolation** | `organizationId` on both models. |
| **Authorization** | Any resident can request; board/property-manager approves if `requiresApproval`; a resident can cancel their own. |
| **Expected size** | Very small `Amenity` catalog (typically 1-10 rows per org); `AmenityReservation` volume scales with how much residents actually use shared amenities. |
| **Expected volume** | Low-to-moderate, seasonal (spikes around holidays/summer for pool/clubhouse bookings). |
| **MVP** | **No — deferred.** Only relevant to associations with shared physical amenities (not universal, per Phase 1), and the existing volunteer-slot pattern means it can be built quickly in a fast-follow once real MVP usage validates demand. Not worth the scope in a first release. |

## What was deliberately not modeled

Per the capability audit: `Vendor`, `ParkingPermit`, `Vehicle`,
`PetRegistration`, a dedicated `ReserveFund`/reserve-study module, and a
standalone `Inspection` model. Each is a real HOA concept, but each is
either low-frequency, adequately served by an existing generic model
(`Category` + `Attachment` for reserve funds; `Violation` for inspection
outcomes), or has no validated demand signal to justify new schema before
a real MVP ships and generates usage data. See
`docs/hoa-capability-audit.md` for the reasoning behind each.
