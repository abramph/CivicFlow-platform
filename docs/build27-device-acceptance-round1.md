# Build 27 — Device Acceptance, Round 1

**Artifact under test:** iOS preview `1.0.0 (2)`, EAS build `64613ba6-5ff0-46b1-8da7-8a814d068352`, commit `1620d1b`, installed on the provisioned iPhone against staging (`build26-staging.187-77-222-173.sslip.io`, serving `1620d1b`, `mobileAdmin` enrolled for Northwind Staging PTA only).

**Diagnosis method:** read-only — staging database queries over SSH (SELECT only, identifiers truncated, emails masked), code inspection at `1620d1b`, EAS build metadata. No code, data, flags, or refs were modified during diagnosis.

## Findings

### F-01 — Dual-role administrator has no My Family

- **Expected:** an administrator who is also a parent has both workspaces, including My Family.
- **Actual:** admin login shows the Admin tab but no My Family.
- **Reproduction:** log in as the staging administrator → Home/tabs show no My Family entry.
- **Severity:** High as an acceptance blocker; **not a code defect**.
- **Root cause — missing staging data / persona mismatch.** The staging administrator (`cmtn58pp90…`, ORG_ADMIN) has **no `PtaHouseholdAdult` link and no `OrgMember`**. The household-linked login is a *different* user (`cmtn58ppq0…`) — the two were seeded milliseconds apart, so their id prefixes collide, which made them look like one account. No dual-role persona existed in staging. The app enforced exactly the Build 27 rule ("admin status never grants parent access"); contract tests prove My Family renders when a real household link exists.
- **Correction:** provision the dual persona through the legitimate flow (done — see "Dual-role persona provisioning" below); no code change.

### F-02 — Announcement area reports no member/family record

- **Expected:** recipient inbox and administrative announcement management are distinct; an admin manages announcements without being a recipient.
- **Actual:** Announcements tab shows the "no member or family record" message.
- **Reproduction:** admin login → Announcements tab.
- **Severity:** inbox portion inherits F-01 (data); management discoverability **Medium**.
- **Root cause — split.** (a) The recipient inbox is empty by design for an identity-less login; the message is the Build 27 honest empty state. (b) The management surface **already exists and never depends on recipient identity**: Admin → Campaigns lists via `communicationCampaign.findMany` (campaign query, not the recipient query), with composer, detail, send, and withdrawal — which is how this device session's "sending works / withdrawal works" passes happened. The suspected reuse of the recipient inbox query **is not present**. The genuine gap: the Announcements *tab* dead-ends for admins instead of routing them to management.
- **Correction:** permission-gated "Manage Announcements" action in the tab header and empty state (commit 4 below). Recipient message and parent/member behavior unchanged.

### F-03 — Student photo uploads but does not display

- **Expected:** after upload, the student photo shows on the student card/detail, survives navigation and restart.
- **Actual:** upload completes; no student photo visible afterward; only the family photo is represented.
- **Reproduction:** My Family → student → Add Photo → complete flow → return to My Family.
- **Severity:** **High**.
- **Root cause — incomplete product scope (a documented deferral), not persistence/API/cache.** Storage verified server-side: **3 student-photo attachments (234–335 KB JPEGs, not deleted)**, `PtaStudent.photoUrl` set on 3 students, and matching `pta.student.photo_uploaded` audit events. The read API works (it drives the roster's "Add Photo"→"Edit Photo" flip). The only surface that *renders* the image is the photo-manager screen; the roster/detail deliberately showed initials — recorded in `build27-final-report.md` §Remaining risks. Acceptance rightly rejects the deferral.
- **Correction:** commit 2 below — render authenticated avatars on the My Family roster and Edit Family student cards, initials fallback, focus-refresh, org-switch staleness guard. Client-only; reuses the existing secured endpoint.

### F-04 — Event RSVP information missing for administrators

- **Expected:** authorized admins see RSVP totals and (subject to permission) who responded.
- **Actual:** no RSVP information anywhere on mobile.
- **Reproduction:** admin → event detail for an event with RSVPs (the staging "test" event has 1 household GOING, 3 attendees).
- **Severity:** **High**.
- **Root cause — mobile API omission; net-new acceptance scope.** The data and services already exist: `PtaEventRsvp` rows are live in staging, and the web officer page already renders household RSVPs via `listPtaEventRsvps` / `getPtaEventAttendanceSummary` (`src/lib/labs/pta/events.ts`). The mobile admin event routes contained **zero** RSVP references. (Admin RSVP visibility was not in the original Build 27 batch scope.)
- **Notes on sub-requirements:** declines/maybe are supported (statuses exist); **capacity/remaining is not representable — `Event` has no capacity field**, and adding schema is out of scope per instruction, so it is reported as not applicable rather than faked.
- **Correction:** commit 3 below — reuse the existing services; no new model, no migration.

### F-05 — Administrator experience remains limited

- **Severity:** **Medium** after decomposition (plus F-04's High).
- **Root cause — mostly empty test data + F-04, small by-design portion.** At test time staging held **0 pending volunteer hours and 0 pending family change requests** (so those cards correctly read 0 with no needs-attention rows), 2 campaigns, 1 active household, **1 open check-in session** (a needs-attention row), and 68 audit events (Recent Activity renders for `manageOrganization` holders; the admin is ORG_ADMIN with default bundles — no overrides exist). `manageMembers` is excluded for PTA orgs by design. The genuinely absent operational content was RSVP (F-04).
- **Correction:** F-04's commit plus dashboard zero-state grouping ("all caught up") in commit 5; parent-persona device actions (submit change requests, volunteer signups) will light up the pending queues without code.

### F-06 — Visual redesign not apparent

- **Severity:** **High** — the finding is accurate.
- **Root cause — incomplete product scope; not a stale bundle.** The artifact is `1620d1b` (build metadata), tokens compiled in, light/dark resolution correct. But adoption was thin: only `StatusChip` was used anywhere (2 screens); `Card`, `StatTile`, `SectionHeader`, `EmptyState` were defined and **unused**; elevation was iOS `shadowOpacity 0.06` (imperceptible); the admin slate accent appeared only on quick actions and the Home admin card. Screen-by-screen delta vs Build 26: *visibly changed* — dues (chips), Edit Family (new), admin quick actions, Home admin card (admins only); *essentially identical* — parent home, My Family, announcements, inbox, profile, scanner, approvals, org-switcher. Icon containers and typography hierarchy from the directive were not delivered.
- **Correction:** commit 5 below — a perceptible pass across the nine target screens.

## Confirmed preliminary passes (server-corroborated)

Announcement sending (2 campaigns exist) · announcement withdrawal (path verified in code and route tests) · personal archive visible · QR scanning active (closed rejection vocabulary confirmed) · student-photo upload control present (3 successful uploads audited). These remain preliminary until authorization, persistence, tenant-isolation, and error-state passes on device.

## Shared-cause determination

F-01 and F-02's *inbox* portion share the identity-linkage cause (staging data). F-02's *management* portion is independent and was already satisfied except for discoverability.

## Dual-role persona provisioning (Option B — done)

An adult row was added to the Northwind household via `addPtaHouseholdAdult` (audited) with the administrator's account email, and a single-use invitation was created via `createPtaHouseholdAdultInvite` (only its hash is stored). The acceptance URL was written to a **root-only file on the staging VPS** (`root:root`, mode `600`, created no-clobber); the token never appeared in chat, logs, git, or command output. Invite expires **2026-09-14T06:36:55Z**. Acceptance is Abram's action: open the URL on the iPhone and enter the administrator account's password — the flow links the existing account (`acceptPtaHouseholdAdultInvite` requires proving the password; it never auto-links).

## Corrections in this branch (stacked on `1620d1b`)

1. This findings document.
2. Student-photo rendering (F-03).
3. Admin event RSVP visibility (F-04, part of F-05).
4. Announcement-management discoverability (F-02).
5. Perceptible visual redesign + dashboard zero states (F-06, part of F-05).

No migration, no feature-flag change, no new RSVP data model. All fixes are JavaScript-only, but **expo-updates is not configured**, so validation on device requires a new EAS preview build (`1.0.0 (3)`) — not triggered without authorization.
