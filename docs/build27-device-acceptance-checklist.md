# Build 27 — iPhone acceptance checklist (staging)

Server: https://build26-staging.187-77-222-173.sslip.io @ 1620d1b · Org: Northwind Staging PTA (mobileAdmin enrolled)
Severity per issue: Blocker / High / Medium / Cosmetic. Synthetic data only — never a real family photo.
Note: ENABLE_EMAIL_SEND=0 on staging — invite/announcement EMAILS will not transmit; verify via in-app state and (for invites) the audit/DB side, or temporarily use INTERNAL_LOG_ONLY channel.

## 0. Session setup
- [ ] Install the new preview build over/alongside Build 26; confirm preview identity + staging badge; confirm traffic hits staging only.
- [ ] Accounts needed: (a) parent-only, (b) admin-only (staff role, no household), (c) admin who is ALSO a linked household adult, (d) account in ≥2 orgs with different roles.

## 1. Dual-role navigation
- [ ] Dual-role login sees Home/Volunteer/Admin tabs simultaneously; Admin dashboard card on Home.
- [ ] My Family fully available in the parent context for the dual-role user.
- [ ] Admin tab shows the workspace note; parent screens are NOT duplicated inside admin.
- [ ] Parent-only login: no Admin tab, no admin card; deep-linking any admin screen shows the unauthorized notice (never a live form).
- [ ] Admin-only login: real dashboard (no blank screen); no My Family; announcements tab explains the missing recipient identity.
- [ ] No sign-out needed to move between workspaces.
- [ ] Org switching: capabilities update immediately; no photo/name/capability leakage from the previous org (switch away from the PTA org and back).

## 2. Family & student management
- [ ] My Family shows roster: adults (self marked), students with placement labels, per-student photo entry.
- [ ] Add a student photo (camera AND library paths); replace it; remove it. Placeholder shows when absent.
- [ ] Student photo is distinct from the family photo (change one, other unchanged).
- [ ] Photo permission flows: neutral priming copy, blocked-state → Settings, cancel paths.
- [ ] Edit Family: own contact info saves immediately; volunteer interests save; success alerts shown.
- [ ] Submit each request type: family name, add student, rename student, class placement (picker lists current-year classes), remove student (confirm dialog).
- [ ] Pending Requests section shows chips; after admin decision, Applied/Not approved states + decision note visible.
- [ ] Verify: loading, success, validation error (empty name), pending-review, rejection, network-error states.

## 3. Administrator dashboard
- [ ] Admin tab: Needs Attention leads; counts match reality (pending hours, pending family changes); Quick Actions show only held capabilities; Recent Activity (manageOrganization holder only).
- [ ] Volunteer-hour queue: approve one; decline one (reason required; empty reason blocked); family's view reflects the outcome and the reason.
- [ ] Family Change Requests screen: approve applies the change to real records (re-check My Family); reject with note; second reviewer racing gets "already reviewed".
- [ ] Parent-only account gets the unauthorized state on every admin surface and 403s on direct API calls.

## 4. Announcements & messages
- [ ] Composer: audience chips (PTA: All families / Unpaid households / All active with email); preview count works; Send Now shows count-confirmation dialog; success lands on detail.
- [ ] Duplicate protection: immediately recreate the identical announcement → clear conflict message, no second campaign.
- [ ] Save as Draft → detail shows Draft → Delete Draft (confirm) removes it; audit row exists.
- [ ] Withdraw a sent announcement: confirm dialog → "Withdrawn" label on admin detail; it disappears from recipient inbox AND archived view; audit row exists.
- [ ] Recipient archive: archive from list and from detail; item leaves inbox, appears under Archived; restore works; second recipient's inbox is UNCHANGED.
- [ ] Read/unread dots and dashboard "N new" behave; a dual-role user's merged list has no duplicates.

## 5. QR scanning
- [ ] Scanner entry visible on Home for parent (household identity) and member; NOT for admin-only.
- [ ] Admin: create/open an attendance session (admin events → session), display QR.
- [ ] Valid scan as parent → "You're Checked In" (household); as member → personal check-in.
- [ ] Duplicate scan (same household/member) → "Already Checked In".
- [ ] Expired token (wait >2 min on a stale screenshot of the QR) → expired copy.
- [ ] Revoked: regenerate QR in admin, scan the OLD code → stale/revoked copy.
- [ ] Wrong org / unauthorized: scan from an account with no tie to the session's org → not-eligible copy.
- [ ] Offline: airplane mode → connection error + Scan Again.
- [ ] Confirm the standard signed-QR is used (scans the session QR minted by the existing admin flow) and no raw token/identifier ever displays.

## 6. Visual design (capture screenshots, light AND dark)
Parent home · My Family · Student detail/edit (Edit Family) · Admin dashboard · Volunteer-hour approval · Announcement composer · QR scanner · Inbox/announcements · the Home admin-card ↔ Admin tab pairing (workspace switcher).
- [ ] Review: color use, hierarchy, contrast, spacing/density, ≥44pt touch targets, status chips, keyboard avoidance on forms, safe areas (notch/home bar), dynamic type at a larger size, light/dark.
- [ ] Parent surfaces read warm/green; admin surfaces read slate/operational; both clearly Unestra.

## Recording template
| # | Area | Severity (Blocker/High/Medium/Cosmetic) | What happened | Expected | Screenshot |
