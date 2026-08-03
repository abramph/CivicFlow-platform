# PTA Volunteer Opportunity ↔ Event Linking (PR #45)

## What this is

`PtaVolunteerOpportunity.eventId` is an optional foreign key to `Event`, letting a volunteer opportunity ("Book Fair Setup Crew") be tied to a specific scheduled event ("Book Fair", March 15). The relation and its cross-tenant validation already existed before PR #45 — this PR is purely UI-surfacing work; no schema change.

## Where it shows up

- **Create/edit opportunity forms** (`CreateOpportunityForm`, `EditOpportunityForm`): an optional "Link to an event" dropdown, populated from the organization's events.
- **Officer manage list & detail** (`/labs/pta/volunteers/manage`, `/labs/pta/volunteers/manage/[id]`): the linked event's title and date shown alongside the existing committee display.
- **Parent-facing browse page** (`/labs/pta/volunteers`): each opportunity card shows the linked event's title/date in place of the freeform description when one is linked.
- **Event detail page** (`/events/[id]`): a new "Linked Volunteer Opportunities" section lists opportunities tied to that event with fill counts. This section is only ever non-empty for a PTA-vertical org — `eventId` can only be set through the PTA-gated opportunity API — so no separate vertical check was needed on the Event page itself.

## Behavior

- An opportunity can be created with or without an event, linked later via edit, re-linked to a different event, or unlinked (`eventId: null`).
- Every non-null `eventId` (create or update) is revalidated against `Organization.id` — linking to a different organization's event fails closed with `PTA_EVENT_NOT_FOUND`, never leaking whether the event id exists elsewhere.
- `eventId: null` (unlinking) skips revalidation — there's nothing to check for null.
- Duplicating an opportunity (`duplicatePtaVolunteerOpportunity`) deliberately does **not** carry the event link forward — a duplicated opportunity (typically reused year-over-year, like "Book Fair" itself recurring) is unlikely to belong to the same dated event instance.
- Cancelling an event (a status flag) does not affect a linked opportunity in any way. There is no hard-delete for events anywhere in the app; if one were ever added, `PtaVolunteerOpportunity.eventId`'s FK is `onDelete: SetNull` — the opportunity and all its volunteer signup/hour history would survive with the link cleared, never cascade-deleted.
- Volunteer shifts (`PtaVolunteerSlot`) keep their own independent `startAt`/`endAt` — linking to an event does not constrain or auto-fill shift scheduling. A shift can still be scheduled the day before the event, for setup.

## Known limitation: mobile

Every mobile PTA volunteer route (`/api/mobile/pta/volunteers/*`) explicitly maps a fixed response shape rather than spreading the underlying query result. Adding `event` to the shared `listPtaVolunteerOpportunities`/`getPtaVolunteerOpportunity` queries is fully backward compatible (zero behavior change for existing mobile clients) but means mobile currently shows **no** event-link information at all. Deliberately not addressed in this PR — no new mobile screens were built, per scope.
