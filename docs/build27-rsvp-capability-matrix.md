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
| Web admin | `/events/[id]` (`events:read`): RSVP **count** StatCard — **no respondent list** ⇒ GAP (fixed this round) |
| Mobile admin | detail: full view (155c9ca); **list: no counts** ⇒ GAP; **dashboard: no planning info** ⇒ GAP (all fixed this round) |
| Member/parent | own `rsvp` block only — never the org-wide list |

### 2. Events (PTA)

| Aspect | Finding |
|---|---|
| Model / semantics | `PtaEventRsvp` — household, per `PtaHousehold`, `attendeeCount` = whole household incl. guests |
| Guests / invitations / capacity / waitlist | **yes (`attendeeCount`)** / not tracked / none / none |
| Canonical services | `setPtaEventRsvp`, `listPtaEventRsvps`, `getPtaEventAttendanceSummary`, admin: `getAdminEventRsvpView` |
| Web admin | `/labs/pta/events/[eventId]` officer page: full household list + summary — satisfied |
| Mobile admin | same gaps/fixes as core events (shared screens) |
| Parent | own household RSVP only |

### 3. Meetings (core)

| Aspect | Finding |
|---|---|
| Model / semantics | `MeetingRsvp` — individual, parallel to `EventRsvp` |
| Canonical services | `setMeetingRsvp`, `listMeetingRsvps`, `getMeetingRsvpSummary` (`src/lib/meeting-rsvp.ts`) — admin view added this round (`getAdminMeetingRsvpView`) |
| API | member self-RSVP: `/api/mobile/meetings/[id]/rsvp`; list carries normalized `rsvp` block |
| Web admin | `/meetings/[id]` (`meetings:read`): expected-attendance StatCard (both modes) — **no respondent list** ⇒ GAP (fixed this round) |
| Mobile admin | **no admin meeting surfaces exist on mobile at all** (no `/api/mobile/admin/meetings`, no screens). Meetings administration is web-first. This round: meetings join the mobile admin dashboard planning indicator (counts only, behind a new `manageMeetings` capability); the respondent list lives on the web meeting detail. Remaining limitation, documented. |
| Member | own `rsvp` block only |

### 4. Meetings (PTA)

Same as (3) with `PtaMeetingRsvp` (household, `attendeeCount`), services in `labs/pta/meetings.ts` (`listPtaMeetingRsvps`, `getPtaMeetingAttendanceSummary`). Parent RSVPs via `/api/mobile/pta/meetings/[id]/rsvp`. Web meeting detail shows household counts; list added this round.

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
- **Mobile**: admin event list cards show "N going · M expected" / "No responses yet"; admin dashboard "Upcoming Attendance" section; detail rows show last-update time; focus-driven refresh + org-tagged state on admin event list/detail.
- **Web**: respondent lists added to `/events/[id]` (individual mode; household mode continues to defer to the PTA officer page) and `/meetings/[id]` (both modes).
- **Desktop/Electron**: the desktop product does not embed these portal surfaces; web parity covers every browser-delivered admin surface. No desktop work required.

## Authorization contract (all server-side)

Mobile events: `requireMobileAuth` → `requireMobileAdminAccess` → `manageEvents` flag (`events:write`), tenancy-scoped queries, cross-org ⇒ 404. Mobile dashboard: per-flag sections (`manageEvents` / `manageMeetings`). Web: `requirePermission("events:read")` / `requirePermission("meetings:read")` — the pages' existing gates, which already exposed counts; lists ride the same gate. PTA officer pages keep their existing labs guards. Members/parents keep exactly their own-RSVP visibility; respondent names only ever appear behind the admin gates, and **no contact fields (email/phone/address) are ever included in respondent rows** — names + status + counts + timestamps only.
