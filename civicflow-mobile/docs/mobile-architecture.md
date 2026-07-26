# Unestra Mobile — Architecture

## Status

Built on Expo SDK 54 / React Native 0.81.5 / React 19.1.0, `expo-router` file-based navigation. This document reflects the state after adding the PTA volunteer bridge (`agent/unestra-mobile-release`) — not yet merged, not submitted anywhere.

## Product scope so far

Pre-existing (before this branch): authentication (login, MFA, invite acceptance), organization switching, dashboard, announcements, events, dues/payments (balance, payment methods, payment-link handoff, report-a-payment with receipt photo), inbox/messaging, QR meeting attendance (check-in + history), push-notification device registration, profile/preferences.

Added this branch: a full parent volunteer experience (browse/claim/cancel shifts, upcoming/completed commitments, family hour-goal progress), a limited Volunteer Coordinator event-day workflow (staffing summary, roster, check-in/check-out/attendance confirmation, hour approval), and — in a later pass on the same branch — full PTA parent parity across Announcements, Events/RSVP, Dues/payment reporting, Inbox, Meeting Minutes, and Documents (see "PTA parent parity" below). Officer administration beyond this stays web-first, per explicit scope.

## Authentication

Bearer-token, not cookie-session — a deliberate split from the web portal's NextAuth cookie session, since native mobile clients can't rely on browser cookies. See `civicflow-portal/src/lib/mobile-auth.ts`.

- **Access token**: 15-minute HS256 JWT (`MOBILE_JWT_SECRET`), held only in memory (`api-client.ts`'s `tokenState`) — never persisted.
- **Refresh token**: 30-day HS256 JWT, persisted via `expo-secure-store` (iOS Keychain / Android Keystore), with a `localStorage` fallback only on the `web` platform target (which has no native secure-storage backing).
- **Revocation**: both token types embed `User.mobileTokenVersion`. Bumping it (password reset, explicit mobile logout) invalidates every previously-issued token for that user at once — there is no separate denylist, since the tokens are otherwise stateless.
- **Auto-refresh**: `apiFetch()` transparently retries once on a 401 by exchanging the refresh token for a new pair; a failed refresh triggers `onSessionExpired` (registered by `AuthProvider`), which signs the user out and returns to `/login`.
- **Eligibility to log in at all**: `completeMobileLogin()` requires either (a) an active `OrganizationMembership{role: MEMBER}` row (the general case), or (b) a `PtaHouseholdAdult.userId` link in at least one active PTA household (added this branch — see "PTA identity" below). Neither existing before this branch meant every PTA parent was permanently unable to obtain a mobile token at all.

## Organization context

`GET /api/mobile/organizations` returns every organization the caller can meaningfully open, merged from three independent identities by `organizationId`:

1. A regular `OrganizationMembership{role: MEMBER}` + linked `OrgMember` (pre-existing, unchanged).
2. A `PtaHouseholdAdult.userId` link — added this branch. PTA parents have **no** `OrganizationMembership` at all (the household's one shared `OrgMember` is a billing identity, not a per-adult one), so without this branch the org-switcher would be permanently empty for every PTA parent even after the login fix above.
3. A staff-role `OrganizationMembership` that holds `pta:volunteers:checkin` or `pta:volunteer-hours:approve` in a PTA-enrolled org — added this branch, the Volunteer Coordinator entry point. Deliberately **not** "any staff role in any org" — an officer with no PTA permission has nothing to do in this app yet.

A single organization can carry both a parent and an officer identity at once (e.g. a PTA president who is also a household adult in their own PTA) — these are merged into one row, never duplicated.

`MobileOrganization.pta` (nullable) carries this: `{ householdAdultId, isOfficer, canCheckIn, canApproveHours }`. `null` means the org has no PTA relevance for this caller at all — `(tabs)/_layout.tsx` uses this to hide the Volunteer tab entirely (`href: null`), not just disable it, matching the explicit "never show PTA features for organizations not enrolled" requirement.

Switching organizations clears all organization-scoped React state on the next screen mount (each screen re-fetches keyed off `selectedOrganizationId` via `useCallback`/`useEffect` dependencies) — there is no cross-organization cache to go stale.

## PTA parent parity (Announcements, Events/RSVP, Dues, Inbox, Minutes, Documents)

Resolved in a later pass on this same branch — see `mobile-pta-parent-parity.md` and `mobile-pta-api-matrix.md` for full detail. Summary: Announcements, Events, Dues, and Inbox previously required a personal `OrgMember` (`requireMobileMembership()`), which a pure PTA household adult never has. Each screen now branches on identity (`hasMemberIdentity` from `selectedOrganization.memberId` vs. the PTA household link) and calls either the conventional route or a new parallel `/api/mobile/pta/*` route backed by `requireMobilePtaHouseholdAccess()` — never both, never a fabricated membership. Inbox took a different fix: its underlying data (`ConversationParticipant`) was already `userId`-scoped, not `memberId`-scoped, so its guard was simply loosened to `requireMobileOrgAccess()` rather than duplicated. RSVP, Meeting Minutes, and Documents are genuinely new mobile surface area (no prior mobile or web-parent-facing equivalent existed to bridge).

Two areas remain deliberately unbridged for a pure PTA parent, by design rather than oversight: Profile's comms-preference toggles (the underlying `OrgMember` is the household's one shared billing identity, not a per-adult record — editing it would either affect every adult in the household or require fabricating new per-adult schema) and a parent-facing Meetings/agenda list (the web's own meeting list is staff-only `meetings:read`-gated, so there's no existing parent precedent to bridge; building one is a new authorization decision, not a bridge).

## New PTA-specific guards (portal side, `mobile-auth.ts`)

- `requireMobilePtaHouseholdAccess(request, organizationId)` — parent-side. Verifies the bearer token, checks PTA Labs enrollment, then resolves the caller's own `PtaHouseholdAdult` by `{organizationId, userId}` (never a client-supplied household/adult id). Mirrors the web's `requirePtaHouseholdSelfAccess()` exactly.
- `requireMobileStaffPermission(request, organizationId, permission)` — officer-side. Verifies the bearer token, requires a real non-`MEMBER` `OrganizationMembership`, checks PTA Labs enrollment, then checks the specific permission via the same `getEffectivePermissions()` (org-customizable via `OrgRolePermissionSet`) the web uses. Mirrors `requirePtaAccess(permission)`.

Both throw `MobileForbiddenError` (403), handled uniformly by `withApiErrorHandling()` — no new error-handling path was introduced.

## API client

`src/lib/api-client.ts` (unchanged this branch) — a single `apiFetch<T>()` wrapper handling auth headers, automatic refresh-on-401, and error normalization into `ApiError`. `src/lib/mobile-api.ts` adds typed wrapper functions for the `/api/mobile/pta/*` surface (volunteers, then announcements/events/RSVP/dues/minutes/documents), following the exact same one-function-per-endpoint pattern already used for every other API area in this file, plus a small set of `*ForIdentity()` routing helpers (`getAnnouncementsForIdentity`, `markAnnouncementReadForIdentity`, `getEventsForIdentity`) that centralize the conventional-vs-PTA route choice so screens don't each re-derive it.

## Navigation

File-based via `expo-router`. Tab bar (`(tabs)/_layout.tsx`): Home, Inbox, Announcements, Payments, Events, **Volunteer** (conditionally hidden for non-PTA orgs), Profile — all seven tabs are shown to every identity; each screen internally branches on `hasMemberIdentity`/PTA household presence rather than the tab itself being hidden, since a PTA parent needs Announcements/Events/Payments/Inbox same as a conventional member. Stack screens (registered in the root `_layout.tsx`): `volunteer-opportunity/[id]` (parent shift detail + claim/cancel), `volunteer-checkin` (officer staffing summary), `volunteer-checkin/[opportunityId]` (officer roster + check-in/out/attendance), `volunteer-hour-approvals` (officer approval queue), `pta-report-payment` (PTA dues-only payment report, parallel to the conventional `/report-payment`), `minutes` (approved meeting minutes), `pta-documents` (PTA document list, honest non-downloadable state).

## Push notifications

Pre-existing (`push-registration.ts`): Expo push token acquisition (gracefully no-ops on simulators or when no EAS `projectId` is configured), registered to `/api/mobile/register-device`, cleaned up via `/api/mobile/unregister-device` on logout. Deep-link handling on notification tap (`deep-links.ts`) validates against an allow-list before navigating — not extended with new PTA-specific notification categories this branch (see "Known limitations" below).

## Offline behavior

No offline caching layer exists anywhere in the app today (pre-existing, unchanged) — every screen fetches on mount/focus and shows a loading spinner, with pull-to-refresh (`RefreshControl`) for manual re-fetch. The new volunteer screens follow this same pattern; no new offline-specific work was done this branch.

## Testing

Jest (`jest-expo` preset), `*.test.ts` matched: `mobile-api.test.ts` (extended twice — volunteer workflow, then PTA parent parity + identity routing — 50 tests total), `unread-count.test.ts`, `deep-links.test.ts`. 50/50 passing after this branch's additions. No component-rendering tests exist in this project (no React Native Testing Library / react-test-renderer configured) — screens were verified via `tsc`, `eslint`, a successful Metro/web bundle, and live `curl`-based verification of the underlying API against a real disposable Postgres database with real seeded accounts (a pure PTA parent and a PTA officer). Interactive UI testing (tapping through the actual rendered screens) could not be completed in this environment — see `mobile-release-checklist.md` for exactly what was and wasn't tested. Adding real component-level tests for navigation visibility, RSVP interaction, and rendering state would require introducing new test infrastructure — a deliberate scope boundary, not an oversight.

## Known limitations (this branch)

- Self-reported volunteer hours, notifications for volunteer events (signup confirmation, shift reminders, hour approval/rejection), and offline caching of volunteer data are all deliberately out of scope this pass (matching the portal-side PR #21's own deferred scope).
- Announcements/Events/Dues/Inbox tabs are not yet bridged for a pure PTA parent identity (see above) — only Volunteer + the Dashboard's volunteer card work for that identity today.
- No QR-based volunteer check-in (the API surface — idempotent, server-timestamped check-in/check-out endpoints — is already the natural integration point for one later, per the PTA volunteer-management docs on the portal side).
- `AGENTS.md` in this repo references Expo SDK v57 docs; the project is actually on SDK 54 (downgraded previously for public Expo Go compatibility — see project memory). That file is stale and should be corrected or removed in a future pass; this branch followed the actual installed SDK version and existing code conventions instead.
