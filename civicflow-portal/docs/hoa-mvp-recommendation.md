# HOA MVP and Technical Recommendation (PR #41 discovery)

Recommendation only — no code, schema, or migrations in this PR. See
`docs/hoa-capability-audit.md`, `docs/hoa-domain-model.md`,
`docs/hoa-capability-matrix.md`, `docs/hoa-navigation-proposal.md`, and
`docs/hoa-mobile-strategy.md` for the supporting detail this recommendation
is built on.

## Phase 9 — Integration opportunities (reuse without duplication)

| Existing system | HOA reuse |
|---|---|
| Payments (`DuesAccount`/`DuesCharge`/`DuesPayment`/`DuesAdjustment`) | Full reuse — assessments and violation fines are both just `DuesCharge` rows, zero new payment infrastructure. |
| Documents (`Attachment`) | Full reuse — governing documents, meeting packets, request/violation photos all use the existing polymorphic model. |
| Meetings (`Meeting`/`MeetingMinutes`) | Full reuse — board meetings and their minutes-approval workflow need nothing new. |
| Communications (`CommunicationCampaign`) | Full reuse — announcements and "emergency alerts" are the same delivery mechanism. |
| Reports (`/reports` infrastructure) | Full reuse of the reporting *infrastructure*; new report *content* (violations-by-status, assessments-by-property) is a query addition, not a new system. |
| Audit logs (`AuditEvent`) | Full reuse — every HOA-specific mutation (violation status change, architectural decision) should write an `AuditEvent` exactly like `organization.primary_vertical_changed` already does; no new audit mechanism. |
| QR attendance (`AttendanceRecord`/`MeetingAttendanceSession`) | Full reuse — board-meeting quorum tracking is a real HOA governance need already served by the existing meeting attendance/QR check-in system (already generalized to Events per prior work), no vertical-specific change needed. |
| Notifications (push/email) | Full reuse. |
| **Volunteer system** (`PtaVolunteerOpportunity`/`Slot`/`Signup`) | **Pattern reuse, not feature reuse.** HOA has no validated need for PTA-style volunteer coordination (no evidence any real HOA workflow maps to "sign up for a shift"). What *is* reused is the underlying shape — a reservable, time-boxed resource with a capacity and a claim against it — as the direct template for `Amenity`/`AmenityReservation` (see domain model doc). Don't build HOA volunteer coordination; do borrow the proven data shape for amenities. |
| **Committees** (`PtaCommittee`/`PtaCommitteeMember`) | **Not reused, and not proposed as new for HOA either.** `PtaCommittee` is PTA-specific schema. For HOA, "committees" are handled entirely through role/permission assignment (Committee Chair/Member roles in `docs/hoa-navigation-proposal.md`'s Phase 5) — no modeled entity needed for MVP. If a future cross-vertical need emerges (Community and Union both plausibly want real committees too), a generic `Committee` model would be a separate, cross-cutting discovery — out of scope here. |

## Phase 11 — MVP recommendation

### Must have

1. **`Property`** — the foundation; nothing else works without it.
2. **`PropertyResident`** — without it, `Property` has no residents/owners.
3. **Residents reuse `/members`, Assessments reuse `/dues`, Board reuses `/settings/users`, Meetings/Documents/Communications/Reports reuse their existing pages** — this is "must have" in the sense that it's required for a coherent product, but requires zero new engineering, only relabeling that (per the capability audit) is already done.
4. **`Violation`** — the single highest-value new capability (Phase 1 frequency rank #6, and the top of the "genuinely new" list) — this is the capability associations most viscerally feel the absence of when self-managing off spreadsheets.
5. **`ArchitecturalRequest`** — second-highest-value new capability (Phase 1 rank #7), and structurally simple (a linear submit → decide workflow, no billing entanglement).

**Why these two together, not just one**: they're the two new-entity
capabilities validated as both common (Phase 1) and currently fully unmet
(Phase 2) — including only one would leave an MVP customer needing to keep
a spreadsheet for the other, undermining the whole pitch.

### Nice to have (fast-follow, not blocking initial release)

6. **`MaintenanceRequest`** — real and validated, ranked just below
   Violation/Architectural in frequency, and structurally the
   lowest-risk addition possible once the other two exist (same shape as
   `Violation` minus the compliance/legal weight, no billing
   entanglement). Recommend shipping it 1 release after the initial MVP
   rather than blocking on it — it doesn't change the domain model's
   shape once designed, so deferring it costs nothing architecturally.

### Future (validated demand, deliberately sequenced after MVP)

7. **`Amenity`/`AmenityReservation`** — real, but only relevant to
   associations with shared physical amenities (not universal), and the
   existing volunteer-slot pattern means it can be built fast once
   there's real signal for it.
8. **Vendor management** — real but lower-frequency and, per the
   category's own products, often just a contact list; revisit once MVP
   usage shows associations asking for it.
9. **Parking permits / vehicle registration / pet registration** — real
   but niche; small models if ever built, no urgency.
10. **Board voting/elections** — real, annual-cadence workflow; distinct
    enough (ballot design, quorum rules, secret-ballot expectations) to
    warrant its own discovery pass rather than being folded into this
    one.

### Never

- **Rental-property management** (tenant screening, lease management,
  landlord-tenant maintenance-for-landlords) — explicitly a different
  product category with different buyers (Phase 1 scope note); building
  this would be mission creep into a market Unestra doesn't compete in.
- **A "Guest" role** — no validated use case anywhere in this product;
  every real HOA participant already fits `MEMBER` or above.
- **A standalone reserve-fund computation module** (funding-percentage
  calculations, component-level reserve study data) — even dedicated HOA
  products mostly treat this as a document + a budget line; building a
  computed reserve-study engine is a specialized product in its own
  right, not an MVP feature.
- **A standalone `Inspection` model** — folds into `Violation` (the
  outcome of an inspection *is* a violation, or the absence of one).
- **Mobile architectural-request approvals** — a board-level decision
  that belongs at a desk with full context, not a quick mobile tap.
- **Mobile resident-facing document upload** — governing documents are a
  board-managed, low-frequency, desk workflow.

## Phase 12 — Technical recommendation

| Dimension | Estimate | Basis |
|---|---|---|
| **New schema (models)** | **5** for MVP (`Property`, `PropertyResident`, `ArchitecturalRequest`, `Violation`, + one supporting enum-bearing model each needs no separate table — see domain model doc for exact field lists). `MaintenanceRequest` is a 6th if bundled into the same release; `Amenity`/`AmenityReservation` (2 more) are explicitly deferred. | Directly from `docs/hoa-domain-model.md`'s validated entity list. |
| **Estimated routes (pages)** | **~11–15** for MVP: Properties (list, detail, new — 3), Violations (list, detail, new, status-update — effectively 3-4 pages plus an action), Architectural Requests (list, detail, new, review action — 3-4 pages plus an action), plus minor edits to existing pages (dashboard, nav) — not new routes. | Mirrors the page count PTA needed for a comparable number of new entities, scaled down since HOA reuses far more existing pages than PTA did (see navigation proposal's "hybrid reuse" recommendation). |
| **Estimated APIs** | **~15–20** — roughly one API route per page (list/create) plus a handful of action-specific routes (approve/deny architectural request, update violation status, resolve/waive). | Same reasoning as routes; HOA needs meaningfully fewer new API routes than PTA did because assessments/residents/meetings/documents/communications reuse existing APIs entirely. |
| **Estimated mobile screens** | **1 new** (read-only "my property's violations") for MVP; everything else already works via existing screens (Payments, Announcements, Events) or is explicitly deferred past MVP. | `docs/hoa-mobile-strategy.md`. |
| **Migration complexity** | **Low.** All new tables, purely additive — no changes to any existing table's shape beyond possibly a new `Category.type` vocabulary value ("PROPERTY"), which needs no schema change at all (`type` is already a free string). No backfill, no data migration — there is no legacy HOA data anywhere in the system to migrate (HOA orgs today have zero domain data beyond `primaryVertical`). | Confirmed by inspecting the current schema — every proposed new model is a clean addition with foreign keys only into `Organization` and `OrgMember`, both stable, unchanged targets. |
| **Risk level** | **Low-to-medium.** Low risk of breaking existing functionality — this is additive schema plus new pages, not a change to any shared code path Community/PTA/Union depend on. Medium complexity specifically in getting the authorization/guard layer right the first time — recommend applying the exact lesson from PR #40's PTA graduation work: centralize all HOA-specific access checks (property-vertical check, resident-vs-board authorization, cross-property isolation) into one guard module from day one, rather than the pattern of scattering checks across routes that PTA had to later consolidate. | Direct lesson from this codebase's own history (`docs/pta-access-architecture.md`'s "one choke-point" discovery). |
| **Testing strategy** | Mirror PTA's proven structure: (1) unit tests for each domain-model CRUD module (`properties.ts`, `violations.ts`, `architectural-requests.ts` equivalents to `households.ts`), (2) a dedicated `guard.ts`-equivalent with its own full test suite (mirroring `guard.test.ts`'s coverage of vertical/status/relationship checks), (3) at least one real-database integration test proving cross-property isolation (a resident cannot see another property's violations/requests by guessing an id — directly modeled on `parent-dues-multi-org.integration.test.ts`), (4) regression assertions that Community/PTA/Union/existing HOA terminology-only behavior is unaffected. | Existing, proven pattern in this exact codebase — no new testing philosophy needed. |
| **Seed strategy** | Create `seed-hoa-demo.ts`, directly modeled on `seed-pta-demo.ts`: a fictional HOA organization (`primaryVertical: "HOA"` set explicitly, learning from the exact `primaryVertical`-omission bug `seed-pta-demo.ts` had before it was fixed in PR #40) with fictional properties, residents/owners, a few violations in different statuses, and a couple of architectural requests. **Correction during this discovery**: an organization named "Oak Ridge Homeowners Association" was observed in one disposable local-dev Postgres instance used earlier in this project, but it is **not** produced by any committed seed script (confirmed — no reference to it exists in `prisma/seed.ts` or anywhere else in the repo except as unrelated example data in a test file's mock request body). It was ad-hoc data from a prior manual session, not a reusable fixture. `seed-hoa-demo.ts` needs to be written from scratch. | Verified by grepping the full repo for "Oak Ridge" — the only match is incidental test-mock data, not a seed script. |
| **Mobile impact** | **Low.** Zero required new mobile work beyond one small read-only screen; everything else already works or is explicitly sequenced after its web counterpart. | `docs/hoa-mobile-strategy.md`. |
| **Deployment impact** | **Low.** Additive-only migration (same "no production data affected" pattern every prior vertical PR in this repo has used), no billing changes, no changes to existing customer-facing behavior for any other vertical, no changes to authentication/session/onboarding flows. | Consistent with this repo's established migration discipline (`prisma migrate deploy`, additive-only, confirmed by every prior vertical PR's own validation report). |

## Recommendation for PR #42 (the first HOA implementation PR)

Scope PR #42 to exactly the "Must have" list above:
`Property` + `PropertyResident` + `Violation` + `ArchitecturalRequest`,
plus the relabeling/reuse of existing pages for residents, assessments,
board, meetings, documents, communications, and reports. Explicitly
exclude `MaintenanceRequest` and everything in "Future"/"Never" from
PR #42's scope — those are separate, later PRs by design, not because
they're unimportant, but because keeping PR #42 to the two
highest-validated new capabilities keeps it reviewable, keeps risk low,
and lets real usage from an actual HOA MVP inform whether
`MaintenanceRequest`/`Amenity`/anything else is worth building next,
rather than guessing all of it upfront.

Before PR #42 starts, apply this discovery's one open technical
prerequisite: design the centralized HOA access-guard module (property
resolution, resident-vs-board authorization, cross-property isolation)
*before* writing the first page — not as a refactor afterward, learning
directly from PTA's own retrospective on that exact mistake.
