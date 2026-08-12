# Unestra Mobile — PTA Parent Parity

## Goal

A pure PTA parent — linked through an active PTA household and household-adult record, with **no** conventional `OrganizationMembership` — can sign in, select their PTA, and use every parent-facing mobile feature a conventional member has, without errors, empty-organization state, permission leakage, or manually typed routes. This document covers the pass that closed the gap `mobile-architecture.md` previously flagged: Announcements, Events, Dues, and Inbox not working for a household-only parent.

## The identity model (unchanged, just newly bridged everywhere)

Three independent identities can exist on one organization, and a caller can hold more than one at once:

1. **Conventional member** — `OrganizationMembership{role: MEMBER}` + `OrgMember`. Has `memberId` in `/api/mobile/organizations`.
2. **PTA household parent** — `PtaHouseholdAdult.userId` link. Has `pta.householdAdultId`, `memberId: null`. The household's dues/announcement billing identity (`PtaHousehold.orgMemberId`) is **shared across every adult in the household** — never a personal `OrgMember`.
3. **PTA officer** — a staff-role `OrganizationMembership` holding a PTA permission. Has `pta.isOfficer`.

`hasMemberIdentity` (from `selectedOrganization.memberId`) always wins when both are present — matching how the pre-existing Dashboard already treated it as the "primary" identity for an officer who is also a parent.

## What changed this pass

### Portal (civicflow-portal)

- **`requireMobileOrgAccess()`** (new, `mobile-auth.ts`) — the loosest of the three mobile guards: true if the caller has *any* of the three identities above. Used for surfaces that never actually needed a personal `OrgMember`, just proof of active access to the org.
- **Inbox/messages** — swapped `requireMobileMembership` → `requireMobileOrgAccess` on all three routes (`conversations`, `[id]`, `[id]/messages`). `ConversationParticipant` is `userId`-scoped, not `memberId`-scoped, so the membership requirement was never load-bearing — this is a guard swap, not a new messaging system.
- **`/api/mobile/payment-methods`** — same swap. The query is `{organizationId, isActive}` only, no member filtering at all.
- **New parallel routes** under `/api/mobile/pta/`, each guarded by `requireMobilePtaHouseholdAccess()` and delegating to the same library functions the web PTA parent portal already uses (no duplicated business logic):
  - `announcements`, `announcements/[id]/read` — shares `mobile-announcements.ts` with the conventional route.
  - `events`, `events/[eventId]/rsvp` — RSVP is household-scoped (`PtaEventRsvp`, `@@unique([eventId, householdId])`); reuses `setPtaEventRsvp`/`listPtaEventRsvps` from `events.ts` unchanged.
  - `dues`, `dues/report-payment` — reuses `parent-dues.ts` (`getPtaParentDuesSummary`, `reportPtaDuesPayment`) unchanged. Deliberately **not** an automatic Stripe-reconciliation flow — see that module's own doc comment for why (the existing PaymentLink webhook has no `memberId`/`duesChargeId` metadata platform-wide, not a PTA-specific gap).
  - `minutes` — reuses `listApprovedPtaMinutes()`.
  - `documents` — genuinely new (`listPtaOrganizationDocuments()`), narrowly scoped to `purpose: "pta_document"`, always `downloadable: false` (seeded documents have fictional `objectKey`s with no real file behind them).

### Mobile (civicflow-mobile)

- **`mobile-api.ts`** — new typed functions for every route above, plus routing helpers so screens don't each re-derive the branch: `getAnnouncementsForIdentity` / `markAnnouncementReadForIdentity` (conventional-vs-PTA by `hasMemberIdentity`), and — since the Core Event RSVP program — `getEventsForOrganization`, which picks the events route from the org's explicit `capability.rsvp` contract instead (the former `getEventsForIdentity` is retired).
- **Announcements** (list + detail) — routes through the identity helpers; unread/read-state and rendering are identical either way since both routes return the same `Announcement` shape.
- **Events** (list + detail) — routes through the identity helpers. The detail screen adds an RSVP control (Going / Maybe / Can't go) that only renders when the event carries `myRsvp` (i.e., came from the PTA route) — conventional events have no RSVP concept in this codebase at all. "Scan Attendance Code" is hidden for a PTA-only identity (no meeting-attendance concept exposed to parents).
- **Dues** — branches entirely, since the PTA and conventional dues shapes are genuinely different (current charge + adjustments + prior charges vs. a flat charge list). The PTA view shows remaining balance, a status pill (Unpaid/Partially paid/Paid/Waived/Voided/Pending review), adjustments, payment history, prior school years, an "Open Payment Options" button (opens the `onlinePaymentLinkSlug` the dues summary already returns — no extra API call), and "Report a Payment" (hidden once a charge is Paid/Waived/Voided).
- **`pta-report-payment.tsx`** (new screen) — a dues-only report form via `reportPtaDuesPayment()`. Deliberately simpler than the conventional `/report-payment`: no category selector (PTA route is dues-only) and no receipt-photo upload (the PTA route has no attachment field — matching the portal API exactly, not a UI omission).
- **`minutes.tsx`, `pta-documents.tsx`** (new screens) — approved minutes and the honest "not downloadable in this demo" document list.
- **Dashboard** — loads announcements/events for either identity via the helpers; adds a PTA dues-balance tile, a pending-report banner (sourced from the charge's own `pendingReportCount`, not the conventional payment-history endpoint), and quick-action buttons for Minutes/Documents/pay-dues/report-payment scoped to the caller's actual identity.
- **Profile** — deliberately **not** bridged for comms-preference toggles or Attendance History (see "What stayed out of scope" below). Name/email/organization display and org switching already worked without changes, since they read from `/api/mobile/organizations`, not `/api/mobile/profile`.

## What stayed out of scope, and why

- **Meetings/agenda list** — no mobile route was built. The web's own meeting list is staff-only (`meetings:read`-gated); there is no existing parent-facing precedent to bridge. Building one is a new product/authorization decision (should parents see agendas and officer notes?), not a bridge onto existing behavior.
- **Profile comms-preference editing** — `commsPushEnabled`/`commsEmailEnabled`/`commsSmsEnabled` live on the household's one shared `OrgMember`. Editing them for a PTA parent would mean either changing a record shared by every adult in the household, or inventing new per-adult schema — neither is "bridging an existing capability." The toggles and Attendance History are hidden for this identity instead of silently failing.
- **Automatic dues payment reconciliation** — unchanged from the pre-existing `parent-dues.ts` design; "report a payment" + officer review remains the only path, since the platform's Stripe webhook has no per-charge metadata anywhere, not just for PTA.
- **Generic payment-history list for PTA parents** — the Dues screen's own "prior school years" section covers the equivalent need without a separate list endpoint.

## Verification

Every new and modified route was proven against a real disposable Postgres database (`civicflow_mobile_dev`), a real seeded pure-parent account (`parent@pinegrovepta.example`, the Kim household, Pine Grove Elementary School PTA), and real bearer-token HTTP calls — not mocks alone:

- Announcements: found and fixed a real bug where the seeded "sent" campaign had zero `CommunicationRecipient` rows (the seed script never fanned them out), making it invisible to every client; fixed and re-verified.
- Dues: confirmed real charge/adjustment/payment data renders correctly; confirmed the business rule that a payment can't be reported against an already-waived charge (honest 403, not a silent failure).
- Events: confirmed RSVP create and update (GOING → NOT_GOING) both persist correctly, household-scoped.
- Minutes/Documents: confirmed real seeded data returns with the documented honest states.
- Inbox: confirmed 200 (not 403) with a correct empty state for a household with no existing conversation.
- **Tenant isolation**: confirmed every PTA route and the org-scoped Inbox route fail closed (403, no data leakage) against a second real PTA-enabled organization (Riverside Elementary PTA) where the test parent has no household link — not just a non-PTA org, which would trivially 403 for an unrelated reason.
- **Access revocation**: deactivating the test household (`PtaHousehold.status = INACTIVE`) took effect on the very next request with the same still-valid bearer token — org discovery immediately dropped the organization, and every PTA route returned 403. No caching of authorization state.

`npx tsc --noEmit`, `npx expo lint`, and `npx jest` (50/50) all pass clean on the mobile app after these changes. No component-rendering tests exist in this project (see `mobile-architecture.md`'s Testing section) — UI verification is limited to type-checking, linting, a successful bundle, and the real-HTTP proof of the underlying API described above.

## Known limitations of this pass's live-walkthrough coverage

- The `PENDING_REVIEW` dues status was exercised via the real "report a payment" call (which correctly rejects a waived charge) and is covered by existing unit tests on the status-mapping function, but no seeded pure-parent login exists with a non-waived current charge to walk the full pending-review state end-to-end live. Creating one would mean adding new fictional demo data, which is in scope but wasn't done this pass — noted rather than silently claimed as tested.
- Inbox read/reply was confirmed to return 200 with an honest empty state, but no second participant exists in the seed data to exercise an actual reply round-trip.
