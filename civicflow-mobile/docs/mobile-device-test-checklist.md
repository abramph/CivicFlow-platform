# Unestra Mobile — Device Test Checklist (PTA Parent Parity)

What should be manually verified on a real device or simulator/emulator before this pass's PTA parent parity work (Announcements, Events/RSVP, Dues, Payment reporting, Inbox, Minutes, Documents) is considered UI-verified, not just API-verified. See `mobile-pta-parent-parity.md` for what was already proven correct via real HTTP calls against a real database.

## Environment status (this pass)

- **No macOS/iOS Simulator** — this development environment is Windows; the iOS Simulator is Mac-only.
- **No physical iPhone or Android device** — none available in this environment.
- **No Android Emulator** — none configured/available in this environment.
- **An EAS Android `preview` build was queued** (see `mobile-preview-build.md`, build `83655609-5045-4fdb-9d0d-14095498d1f4`) but its resulting APK could not be installed or interacted with anywhere in this environment.

This is an unchanged, honest limitation from the prior pass's `mobile-release-checklist.md` — nothing new was possible here, and this document exists to give whoever has device access a concrete, PTA-parity-specific script to run, rather than a generic "test everything" instruction.

## Test accounts (fictional demo data only)

- **Pure PTA parent**: `parent@pinegrovepta.example` / (seeded password, see `civicflow-portal/prisma/seed-pta-demo.ts`) — Casey Kim, Kim Household, Pine Grove Elementary School PTA. No conventional organization membership.
- **PTA officer** (dual identity): `president@pinegrovepta.example` — Morgan Household + officer permissions, useful for confirming the officer path still works unchanged.
- A second PTA org (Riverside Elementary PTA) exists in the same seed data with no household link for Casey Kim — useful for manually re-confirming tenant isolation on-device, matching what was already proven via direct API calls.

## Walkthrough script

1. Log in as the pure PTA parent. Confirm no crash, no blank dashboard.
2. Confirm the organization switcher shows only Pine Grove — never Riverside or any other org this user has no real link to.
3. **Dashboard**: confirm the dues-balance tile, unread-messages tile, volunteer-hours card, next-event card, and quick actions all render with real data (or an honest empty/zero state) — never a spinner that never resolves, never a raw error message on screen.
4. **Announcements**: open the list, confirm the seeded welcome announcement appears and can be opened; confirm it flips from unread to read after opening.
5. **Events**: open the list, tap into an event, change the RSVP (Going → Maybe → Can't go → Going), confirm the chip selection updates immediately and survives a screen re-entry (i.e., actually persisted, not just local state).
6. **Dues**: confirm the current charge, status pill, adjustments, and payment history render correctly; if the current charge is Waived/Paid, confirm "Report a Payment" is hidden; if `onlinePaymentLinkSlug` is present, confirm "Open Payment Options" opens a browser to the real `/pay/[slug]` checkout page.
7. **Report a Payment** (on a charge that accepts one): fill out the form, submit, confirm the success screen, confirm the dues screen afterward shows the report reflected (pending-review state) once linked to the right charge.
8. **Inbox**: confirm the tab opens without error (200, not 403) even with zero conversations; if a conversation exists, confirm it opens and a reply can be sent.
9. **Meeting Minutes** and **Documents** (via the Dashboard's quick actions): confirm both list real seeded items; confirm Documents shows an honest "not downloadable in this demo" note rather than a broken download button or silent failure.
10. **Profile**: confirm name/email/organization display correctly; confirm the Notifications section and Attendance History link are absent (not broken, not blank-but-present) for this identity.
11. Switch to the officer account (or a dual-identity user) and spot-check that the conventional member experience (Dues, Announcements, Events, Inbox, Profile with comms toggles) is unchanged from before this pass.
12. Attempt to reach a PTA route for an organization this user has no household link in (Riverside Elementary PTA, if reachable via a manually-typed deep link or dev menu) — confirm a clean, honest error state, never Pine Grove data bleeding through.
13. Repeat steps 3–10 with airplane mode toggled mid-session, to observe (not necessarily fix — no offline caching layer exists anywhere in this app, pre-existing and unchanged) how each screen behaves when a fetch fails outright.

## What "pass" looks like

No screen in this list should show a raw `ApiError` message, a permanently-spinning loader, or data belonging to another organization. Empty states should read as intentional ("No announcements yet.", "Not downloadable in this demo") rather than as a broken screen.
