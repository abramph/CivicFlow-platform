# HOA Mobile Strategy (PR #42 discovery)

Design only — no mobile screens, API fields, or `supportedModules` values
were added in this PR.

## Current mobile baseline

`civicflow-mobile`'s fixed tab set today: Home, Inbox, Announcements,
Payments, Events, Volunteer (PTA-only), Profile. The
`/api/mobile/organizations` capability object already returns
`primaryVertical`, `terminology`, `quickActions`, `supportedModules`, and
`landingPage` per organization — HOA already gets correct terminology and
quick actions on mobile today (confirmed: `getQuickActions`/
`getVerticalTerminology` are vertical-keyed functions the mobile route
already calls for every vertical, HOA included). What's missing is any
`supportedModules` entry beyond the generic set, because the new domain
entities (Property, Violation, ArchitecturalRequest, MaintenanceRequest,
Amenity) don't exist yet.

## Phase 8 — Workflow classification

| Workflow | MVP / Later / Never | Reasoning |
|---|---|---|
| **Pay assessments** | **MVP** | Already works today — `Payments` tab + existing dues-payment flow is vertical-agnostic. Zero new mobile work required; this is really a "confirm it already works for HOA" item, not a build item. |
| **Receive announcements** | **MVP** | Already works today — `Announcements`/`Inbox` tabs are vertical-agnostic. Same as above. |
| **View violations** (own property, read-only) | **MVP** | High-value, low-risk — a resident wants to know the moment a violation is logged against their property, ideally via push notification. Read-only, no new mutation surface. |
| **Submit maintenance requests** | **Later** | Real value, but the web MVP recommendation (see `docs/hoa-mvp-recommendation.md`) already treats `MaintenanceRequest` itself as a fast-follow rather than initial-MVP — mobile submission naturally follows the web feature's own timeline, not ahead of it. |
| **Submit architectural requests / review approvals** | **Later** | Submission could plausibly go on mobile once the web workflow exists — but this is a form-heavy workflow (description, category, often photo attachments) that's a poor first mobile candidate; better proven on web first, then a lightweight mobile version once the pattern (and real usage) is validated. "Review approvals" (the board's decision side) is a **Never** for mobile in the near term — this is a considered, board-level decision better made at a desk with full context, not a quick mobile approve/deny tap. |
| **Reserve amenities** | **Later** | Amenities themselves are deferred (not MVP) per the domain-model doc — mobile support only makes sense once the underlying feature ships on web and shows real usage. When it does, mobile is a strong fit (a resident deciding "is the clubhouse free tonight" is a classic on-the-go use case). |
| **Upload documents** | **Never** (as a resident-facing capability) | Governing documents are board-managed, uploaded rarely, and need no urgency — this is a desk/web workflow. Residents only ever *read* documents, which the existing document-library surface (once built for HOA specifically, or the generic settings/organization attachment view) already covers without a dedicated mobile upload flow. |
| **Emergency alerts** | **MVP** (as a variant of existing announcements, not a new capability) | Per the capability audit, "emergency alert" is not a structurally different delivery mechanism from an announcement — it's an announcement with urgent framing. No new mobile work needed beyond what `Announcements`/push notifications already do; the only real addition (if ever pursued) would be a push-notification priority flag on `CommunicationCampaign`, which is a small, vertical-agnostic enhancement, not an HOA-specific one. |

## Recommended `supportedModules` additions (when the corresponding web feature ships — not now)

- `"violations"` — gated on the property-owning resident having at least
  one linked `Property`, mirroring how `"volunteers"` is gated on
  `hasPtaAccess` today.
- `"maintenance"` — added when `MaintenanceRequest` ships (fast-follow,
  not initial MVP).
- `"amenities"` — added only if/when `Amenity`/`AmenityReservation` ships
  (deferred, not MVP).

No new module is proposed for assessments, announcements, or events —
these already work through the existing `"dues"`, `"announcements"`,
`"events"` modules every vertical shares.

## What this means for the MVP mobile scope, concretely

Mobile requires **zero new work** for the HOA MVP's first release beyond
what already exists (assessments payment, announcements, events) plus one
small, low-risk addition: a read-only "my property's violations" view.
Everything else (maintenance submission, architectural requests, amenity
reservations) is explicitly sequenced to follow its web counterpart, not
precede it — consistent with how PTA's own mobile support was built after
its web features proved out, not in parallel.
