# Unestra RSVP / Planned-Attendance Capability Matrix

Build 27 Round-1 expansion audit (2026-09-07, at `fb2c54c`). Scope: every model that records **planned attendance** (RSVP or signup), every vertical, every surface. Purpose: give authorized administrators/organizers platform-wide planning visibility — expected headcount and an authorized respondent list — without inventing data the models don't hold.

## Mode authority (unchanged)

`getRsvpMode(primaryVertical)` in `src/lib/event-rsvp.ts` is the single authority, for events AND meetings:

| Vertical | Mode | Model family |
|---|---|---|
| PTA | `household` (guest counts via `attendeeCount`) | `PtaEventRsvp` / `PtaMeetingRsvp` |
| COMMUNITY, UNION, CHURCH | `individual` (1 response = 1 attendee) | `EventRsvp` / `MeetingRsvp` |
| HOA | `none` (deliberate open product decision) | — |

**Meetings are NOT events.** `Meeting` is a separate model (own table, `meetingDate`, `MeetingStatus`, quorum, minutes/agenda relations) with its own parallel RSVP pair — verified, not assumed. `Meeting.quorumRequired` is an informational attendance threshold, not a capacity.

## Matrix

### 1. Events (core: Community / Union / Church)

| Aspect | Finding |
|---|---|
| Model / semantics | `EventRsvp` — individual, per `OrgMember`, statuses GOING/MAYBE/NOT_GOING, no guests (1 GOING = 1 attendee) |
| Guests / invitations / capacity / waitlist | none / not tracked / **`Event` has no capacity field** / none |
| Canonical services | `setEventRsvp`, `listEventRsvps`, `getEventRsvpSummary`, admin: `getAdminEventRsvpView` (155c9ca) |
| API | member self-RSVP via mobile events routes (`rsvp` block); admin: mobile `GET /api/mobile/admin/events/[eventId]` |
| Web admin | `/events/[id]` (`events:read`): RSVP count StatCard **and a full Member RSVPs table** (direct `prisma.eventRsvp` query — a service-level grep missed it; corrected on page read). No gap. |
| Mobile admin | detail: full view (155c9ca); **list: no counts** ⇒ GAP; **dashboard: no planning info** ⇒ GAP (both fixed this round) |
| Member/parent | own `rsvp` block only — never the org-wide list |

### 2. Events (PTA)

| Aspect | Finding |
|---|---|
| Model / semantics | `PtaEventRsvp` — household, per `PtaHousehold`, `attendeeCount` = whole household incl. guests |
| Guests / invitations / capacity / waitlist | **yes (`attendeeCount`)** / not tracked / none / none |
| Canonical services | `setPtaEventRsvp`, `listPtaEventRsvps`, `getPtaEventAttendanceSummary`, admin: `getAdminEventRsvpView` |
| Web admin | `/labs/pta/events/[eventId]` officer page: full household list + summary — satisfied. **Real web gap:** the CORE `/events/[id]` page showed a PTA admin no RSVP information at all and never linked the labs view ⇒ fixed this round (inline Expected Attendees StatCard + Household RSVPs table in the meetings page's exact pattern, plus a link to the officer view). |
| Mobile admin | same gaps/fixes as core events (shared screens) |
| Parent | own household RSVP only |

### 3. Meetings (core)

| Aspect | Finding |
|---|---|
| Model / semantics | `MeetingRsvp` — individual, parallel to `EventRsvp` |
| Canonical services | `setMeetingRsvp`, `listMeetingRsvps`, `getMeetingRsvpSummary` (`src/lib/meeting-rsvp.ts`) — admin view added this round (`getAdminMeetingRsvpView`) |
| API | member self-RSVP: `/api/mobile/meetings/[id]/rsvp`; list carries normalized `rsvp` block |
| Web admin | `/meetings/[id]` (`meetings:read`): expected-attendance StatCard **and full respondent tables for BOTH modes** (Member RSVPs / Household RSVPs incl. attendee counts and updated times) — already satisfied; corrected on page read, no change needed. |
| Mobile admin | Meetings *administration* stays web-first, but RSVP planning is now fully on mobile: the dashboard's Upcoming Attendance meeting rows open the read-only **`/admin-meetings/[meetingId]`** planning screen (new `GET /api/mobile/admin/meetings/[meetingId]`, `manageMeetings`-gated, tenancy 404), showing title/date/mode, the full summary, and the respondent list via the shared `AdminRsvpSection`. No editing/agenda/minutes scope. |
| Member | own `rsvp` block only |

### 4. Meetings (PTA)

Same as (3) with `PtaMeetingRsvp` (household, `attendeeCount`), services in `labs/pta/meetings.ts` (`listPtaMeetingRsvps`, `getPtaMeetingAttendanceSummary`). Parent RSVPs via `/api/mobile/pta/meetings/[id]/rsvp`. Web meeting detail already shows household counts AND the household respondent table — satisfied.

### 5. Volunteer opportunities / shifts (PTA)

| Aspect | Finding |
|---|---|
| Model / semantics | `PtaVolunteerSlot` (`capacity`, CAS-guarded `claimedCount < capacity`) + `PtaVolunteerSignup` (statuses incl. **WAITLISTED**) — individual signup per household adult |
| Capacity / waitlist | **BOTH genuinely modeled — the only place in the platform** |
| Canonical services | `labs/pta/volunteers.ts` (claim/assign/cancel/check-in + rosters) |
| Web admin | `/labs/pta/volunteers/manage/[opportunityId]`: roster, capacity, waitlist — satisfied |
| Mobile officer | `volunteer-checkin.tsx` (`canCheckIn`): per-shift claimed/capacity + roster — satisfied |
| Verdict | **No gap.** Already meets the minimum (visible expected count + authorized list) with capacity/waitlist where modeled. Not rebuilt onto the event-RSVP machinery — different model, different lifecycle. |

### 6. Attendance sessions / QR check-in

`AttendanceRecord`/`AttendanceSession` record **actual presence**, not planned attendance. Explicitly out of RSVP scope (the services document "RSVP is intent; AttendanceRecord remains the sole record of actual presence — the two never mix").

### 7. HOA

RSVP mode `none` everywhere by design. No planning surfaces owed; admin views render nothing (`mode: "none"`).

## Platform-wide answers to the planning questions

- **Expected people / who signed up / responses by status / guests**: available for events + meetings (both mode families) via the canonical summaries; volunteer shifts via their own rosters.
- **Invited-but-not-responded**: **not representable anywhere** — no event/meeting invitation model exists (`MemberInvite`/`PtaHouseholdAdultInvite` are account onboarding, not event invitations). Reported as "not tracked"; never fabricated.
- **Capacity / remaining**: only volunteer slots model capacity. Events and meetings have none — capacity/remaining is displayed **only** on volunteer surfaces.
- **Waitlist**: only volunteer signups (`WAITLISTED`). Displayed only there.

## Count-calculation rules (normative, enforced by the shared services)

1. `totalResponses` = RSVP rows, any status.
2. `going`/`maybe`/`notGoing` = rows per status (households in household mode, members in individual mode).
3. `totalAttendees` (expected headcount) = **household mode:** Σ `attendeeCount` over GOING rows (guests included); **individual mode:** = `going`. Never the raw row count in household mode.
4. Cross-vertical aggregation must aggregate attendees, never rows.

## Surfaces changed this round

- **Server**: `getAdminMeetingRsvpView` (meeting twin of `getAdminEventRsvpView`); batched `getAdminEventRsvpCounts` / `getAdminMeetingRsvpCounts` (groupBy — no N+1) for lists and the dashboard; new mobile admin capability flag `manageMeetings` (`meetings:write`, all verticals); admin events list rows gain a compact `rsvp` summary; admin dashboard gains `rsvpPlanning` (upcoming events for `manageEvents` holders + upcoming meetings for `manageMeetings` holders).
- **Mobile**: admin event list cards show "N going · M expected" / "No responses yet"; admin dashboard "Upcoming Attendance" section (event rows → admin event detail, meeting rows → the new meeting RSVP planning screen); the shared `AdminRsvpSection` component renders the summary + respondent list on both the event detail and the new `/admin-meetings/[meetingId]` screen; detail rows show last-update time; focus-driven refresh + org-tagged state on every admin RSVP surface.
- **Web**: `/events/[id]` gains the household-mode Expected Attendees StatCard + Household RSVPs table + officer-view link (the one real web gap). The individual-mode event table and both meeting tables already existed — no other web change.
- **Desktop/Electron**: the desktop product does not embed these portal surfaces; web parity covers every browser-delivered admin surface. No desktop work required.

## Authorization contract (all server-side)

Mobile events: `requireMobileAuth` → `requireMobileAdminAccess` → `manageEvents` flag (`events:write`), tenancy-scoped queries, cross-org ⇒ 404. Mobile meetings: same ladder with the `manageMeetings` flag (`meetings:write`) on `GET /api/mobile/admin/meetings/[meetingId]`. Mobile dashboard: per-flag sections (`manageEvents` / `manageMeetings`). Web: `requirePermission("events:read")` / `requirePermission("meetings:read")` — the pages' existing gates. **Web respondent-privacy review (2026-09-07):** these read permissions belong to staff roles only (ORG_OWNER/ORG_ADMIN/STAFF/READ_ONLY and up); the `MEMBER` role holds an explicitly empty permission bundle (pinned by rbac tests) and PTA parents hold no `OrganizationMembership` at all, so **no ordinary member or parent can reach any respondent table server-side**; no web `/api` route serves RSVP lists; the PTA officer page has its own labs guard. Respondent visibility for READ_ONLY *staff* matches the portal-wide staff-read policy (that role already reads the member list, attendance, and audit logs) — pinned by `web-rsvp-respondent-authorization.test.ts` so any future change must be explicit. Canonical services enforce tenancy; authorization lives at the route/page gates (the repo-wide pattern). Organizer authority is not separately modeled anywhere (`createdByUserId` is provenance only) — `events:write`/`meetings:write` is the authority. **No contact fields (email/phone/address) are ever included in respondent rows** — names + status + counts + timestamps only.
