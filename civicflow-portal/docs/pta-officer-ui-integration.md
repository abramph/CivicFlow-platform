# Unestra for PTA — Officer UI Integration Sprint

> **Superseded by PR #40 (2026-07-29):** references below to `ptaVertical`
> as the entry-point/enrollment gate are historical — PTA/PTO is now a
> first-class vertical gated by `Organization.primaryVertical === "PTA"`
> alone, with no Labs enrollment step. See
> `docs/pta-access-architecture.md`.

Follow-up to the Product Readiness & UX Review, which found that the PTA
Labs MVP's backend was substantially complete but almost entirely
unreachable through the product's own interface: only 3 of 27 PTA API
routes were wired to any page, and the vertical had no entry point anywhere
in the platform's navigation. This sprint is a **UI integration sprint,
not a backend sprint** — it connects existing, unmodified backend
capabilities to a polished, discoverable web interface. No new Prisma
models, no new migrations, and (with one narrow, documented exception) no
new API routes were introduced.

## Phase 1 — Inventory (before → after)

| Capability | Before | After |
|---|---|---|
| Dashboard | Connected | Connected — added Quick Actions, committees/teachers/pending-payment-report/outstanding-dues cards |
| Household directory (list) | Partially Connected — read-only table, no search, no click-through | Connected — search + status filter, rows link to a real detail page |
| Household create | API Only | Connected — `/labs/pta/households/new` |
| Household edit / deactivate | API Only | Connected — inline on the household detail page |
| Household adults add/remove | API Only | Connected — on the household detail page |
| Students add / deactivate / enroll-in-classroom | API Only | Connected — on the household detail page |
| Academic structure (grades, teachers, classrooms) | API Only | Connected — `/labs/pta/academic` |
| Committees (create, chair, members) | API Only — zero UI at all | Connected — `/labs/pta/committees` + detail page |
| Volunteer opportunity/slot creation (officer) | API Only | Connected — `/labs/pta/volunteers/manage` |
| Volunteer slot claim/cancel (parent) | Connected | Unchanged |
| Dues charge creation / waive / record payment | API Only | Connected — on the household detail page, plus an org-wide `/labs/pta/dues` console |
| Payment report approval | Connected, but off-vertical (base platform's Payment Reports queue) | Unchanged by design — see "What we deliberately did not build" |
| Events (create/edit) | Connected (base platform) | Unchanged by design — PTA never duplicates the Event model |
| Event RSVP review (officer) | API Only | Connected — `/labs/pta/events` + per-event detail |
| Approved minutes | API Only (a GET route existed with zero callers) | Still not surfaced beyond the dashboard's count — **not** built this sprint (not one of the sprint's 20 phases by name; flagged as a residual gap below) |
| Communications targeting (`resolvePtaTargetMemberIds`) | API Only — a lib function with **zero callers anywhere**, not even a route | Still not wired into campaign creation — read-only recent-campaigns view built instead; the gap is now visible and documented rather than invisible |
| Documents | Never existed | Honest "not built yet" placeholder — no document model/API exists, so none was invented |
| Settings/Labs entry point | Hidden — named the feature, gave no way to reach it | Connected — "Open →" link added |
| Sidebar navigation entry | Hidden — did not exist | Connected — a permission- and enrollment-gated "Unestra for PTA" entry |
| In-vertical navigation | Hidden — each page hand-wrote 2-3 footer links | Connected — a shared, permission-aware tab bar (`src/app/labs/pta/layout.tsx`) |
| Onboarding | Never existed | Connected — `/labs/pta/onboarding`, a guided checklist with live progress and real links |

## Phase 2 — Navigation model

Two layers, deliberately not one flat dump:

1. **Global sidebar** (`PortalShell.tsx`) gets exactly one new entry, "Unestra
   for PTA," shown only when `/api/labs/pta/access` reports the feature
   available for the active organization AND the caller holds
   `pta:directory:read`. This is the "is this vertical worth entering at
   all" decision.
2. **In-vertical tab bar** (`src/app/labs/pta/layout.tsx` +
   `PtaTabNav.tsx`), rendered above every `/labs/pta/*` page, is the "where
   do I go once I'm here" decision. Each tab's visibility is gated by the
   exact same permission its target page/route already requires — a tab
   never appears for something the viewer can't use, and nothing reachable
   is missing a tab. Officer tabs and parent tabs (My Household, My
   Membership, Volunteer Opportunities) render as two independent rows, so
   a user who is both an officer and a linked parent (as in the fictional
   seed data) sees both without either crowding out the other.

## Phase 17 — Labs discoverability fix

`src/app/settings/labs/page.tsx` previously named a feature and its status
with no way to act on it. It now renders an "Open →" link for any feature
with a known entry point (currently just `ptaVertical` → `/labs/pta/dashboard`)
when that feature is available — never for an unenrolled organization,
since the link only renders when `item.available` is true.

## The one new API route, and why

`GET /api/labs/pta/access` — returns whether `ptaVertical` is available for
the caller's active organization. No existing route exposed Labs
availability to a **client** component; `settings/labs/page.tsx`'s equivalent
check runs server-side only. The sidebar is a client component
(`PortalShell.tsx`, already using `useSession()`/`useState`), so without this
route it has no way to decide whether to show the PTA nav entry at all —
and showing it unconditionally would violate Phase 17's explicit
requirement never to advertise Labs features to an unenrolled organization.
It reuses the existing `getOrganizationLabAccess()` resolver unchanged; it
adds no new business logic, only a read-only exposure of an existing
answer.

## Minor additive extensions to existing lib functions

No new capabilities were added to any `src/lib/labs/pta/*.ts` module —
these are strictly additive read/include extensions so the UI could render
what officers actually need to see:

- `listPtaHouseholds()` gained an optional `search` filter (name/adult/student
  contains-match) — the household directory needed this for its search box.
- `listPtaVolunteerOpportunities()`'s existing `signups` include now also
  selects the signed-up adult's `name` — the manage console needed to show
  *who* signed up, not just a count.
- `getPtaDashboardMetrics()` gained four fields (`committeesCount`,
  `teachersCount`, `pendingPaymentReportsCount`, `outstandingDuesCents`) —
  all straightforward additional counts/aggregates in the same
  `Promise.all`, no new query patterns.

## What we deliberately did not build

- **Payment report approval UI inside the PTA vertical.** The base
  platform's Payment Reports queue already does this correctly and is
  shared across every feature that uses `createPaymentReportAndNotify()`,
  not just PTA. Rebuilding a parallel, PTA-scoped approval queue would mean
  either duplicating that logic or modifying non-PTA code — explicitly out
  of scope ("do not redesign payments"). The Dues & Payments console links
  to it instead, with copy explaining why.
- **Communications targeting integration.** `resolvePtaTargetMemberIds()`
  (grade/classroom/committee/event-volunteers/unpaid-dues targeting) has
  existed since the original PTA MVP with zero callers. Wiring it in means
  adding a targeting option to the base platform's own campaign creation
  form — non-PTA code, and a real design surface of its own (how does an
  officer pick "grade" vs "committee" vs "unpaid" in that form?). The
  Communications page surfaces this gap honestly instead of building
  something that doesn't fit in the time box.
- **Approved-minutes list/detail page.** Not one of the sprint's 20 named
  phases; the dashboard's existing count is the only surface. Flagged here
  as a residual gap from the original review, not fixed in this pass.
- **Document management.** No backend exists; an honest placeholder page
  was built instead of inventing one.
- **Attendance/check-in.** Explicitly out of scope per the sprint brief.
  "Mark completed" + hours logged (an existing capability,
  `completePtaVolunteerSignup()`) was wired in, since that already existed
  and is volunteer-hour logging, not event check-in/attendance.
- **Mobile-specific work.** Explicitly out of scope per the sprint brief.

## Known remaining gaps

- No dedicated cross-household **student search** page — students are
  managed within their household's own detail page. A PTA with hundreds of
  students across households would eventually want a flatter search; not
  built this sprint given time constraints.
- The volunteer-manage console only shows currently `SIGNED_UP` signups
  (matching `listPtaVolunteerOpportunities()`'s existing include) — a
  history view of completed/cancelled signups per opportunity doesn't
  exist yet.
- A live, authenticated browser walkthrough of the new pages (Phase 19)
  could not be completed in this session: a persistent browser-extension
  popup in the automation environment repeatedly intercepted keyboard
  input on the login form (confirmed unrelated to the app — the same
  popup, and the same interference, occurred identically on the
  already-shipped, unmodified `/login` page). Correctness here rests on:
  a clean `tsc --noEmit`, a clean `next build` (every new route compiles
  and prerenders/streams without error), a clean ESLint pass, the full
  existing test suite (983 passed, 3 skipped, zero failures — confirming
  no regression from the additive lib changes above), and a careful
  line-by-line re-check of every new page against the actual Prisma
  model fields and API route contracts documented above. A live
  persona-by-persona walkthrough is recommended as a fast follow-up once
  that popup is resolved in the automation environment.
