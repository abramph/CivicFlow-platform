# Volunteer-shift QR check-in — investigation findings + deferral

build-26 Phase G. Per the directive's own explicit fallback ("volunteer-shift
QR only if it can be done fully safely, else leave the flag OFF and document
the blocker"), this documents why the feature is deferred rather than built
this pass, and separately confirms the thing the directive assumed might be
broken (PTA-identity gating on "the scanner") is not.

## Part 1: "Correct PTA-identity gating on the scanner" — investigated, not a live bug

The mobile app has exactly one camera-based QR scanner: `attendance-scan.tsx`
(civicflow-mobile). It is deliberately gated on conventional `memberId`
identity, not PTA identity — and that gate is correct, not a bug:

- The backend it calls (`POST /api/mobile/attendance/check-in`,
  `civicflow-portal/src/app/api/mobile/attendance/check-in/route.ts`) resolves
  identity via `requireMobileMembership()`, which requires a real `OrgMember`
  row, and records the check-in against `memberId`
  (`recordAttendanceCheckIn`, `attendance-checkin.ts`).
- A PTA household adult has no `OrganizationMembership`/`OrgMember` by design
  (see `docs/pta-access-architecture.md` and every PTA parent self-service
  guard in `guard.ts`/`mobile-auth.ts`) — there is no `memberId` to record a
  scan against for a pure PTA identity. The screen's own redirect
  (`!selectedOrganization.memberId → /dues`) and its accompanying comment
  ("check-in is recorded against an OrgMember identity a staff/owner login
  may not hold") are an accurate, deliberate description of this constraint,
  not an oversight.
- The dashboard-level entry point to this scanner (`(tabs)/dashboard.tsx`) is
  already gated the same way (`hasMemberIdentity`), so a PTA-only identity
  never even sees a link to it.

Separately, the volunteer-hours check-in surface that already exists — the
roster tap-based flow (`volunteer-checkin.tsx` →
`volunteer-checkin/[opportunityId].tsx`, backed by
`/api/mobile/pta/volunteers/{today,opportunities/*/roster,signups/*/checkin,checkout}`)
— was checked end-to-end and confirmed to already be correctly PTA-scoped:
every backend route uses `requireMobileStaffPermission(request, organizationId,
PERMISSIONS.PTA_VOLUNTEERS_CHECKIN)`, never a generic member check, and the
mobile screen gates on `selectedOrganization.pta.canCheckIn`
(`MobileOrganizationPtaAccess`), never `hasMemberIdentity`. This is the
existing "QR/check-in" surface for volunteers; it does not use a camera at
all today (see Part 2).

**Conclusion: there is no live PTA-vs-member identity gating defect to
correct.** The directive's premise here did not match the current
architecture — consistent with the directive's own instruction to resolve
actual repository state through inspection rather than assume it.

## Part 2: Volunteer-shift QR check-in — does not exist, deferred

No part of a QR-based volunteer check-in exists today:

- No signed/scannable token model for a volunteer signup (nothing analogous
  to the meeting attendance flow's `resolveAttendanceSession(qrToken)`).
- No volunteer-facing screen to display a personal check-in code.
- No coordinator-facing scan screen for volunteers (the only camera scanner
  in the app is the member-attendance one described in Part 1, and it is not
  reusable here — it authenticates a different identity model entirely).
- No reserved feature flag. `VOLUNTEER_HOURS_FLAG_KEYS`
  (`volunteer-hours/flags.ts`) has six keys, none QR-related.

Building this safely would require, at minimum:

1. A signed, short-lived, single-use token binding one `PtaVolunteerSlotSignup`
   to the household adult who claimed it — issued server-side, never
   constructed or trusted client-side (mirroring how `resolveAttendanceSession`
   already treats meeting QR tokens as opaque, server-verified sessions, not
   bearer credentials the client can inspect or forge).
2. A volunteer-facing screen to display that code, with its own privacy
   consideration: it must not leak the volunteer's name/identity to anyone
   who intercepts the raw QR image, since the code will be displayed on a
   personal device in a public event setting.
3. A coordinator-facing scan screen, replicating the camera-permission
   correction from Phase F for a second surface, plus replay/reuse
   protection (a shift's code should not check the same person in twice, and
   should not be usable after the shift's window ends or by a different
   opportunity's coordinator).
4. A new platform + org-level feature flag pair, defaulting OFF, following
   the same dual-gate pattern as `isPtaStudentProgressionPlatformEnabled()` +
   `PtaProfile.studentProgressionEnabled` (Phase B of this same program).
5. A full security review of the new token issuance/verification path before
   any org can turn it on — this is new authentication-adjacent surface,
   not a UI convenience feature, and deserves the same scrutiny given to the
   import-route auth-ordering work and the family-photo upload pipeline
   earlier in this program.

None of that exists yet, and building it to a standard consistent with the
rest of this program's security discipline is a separately-scoped effort,
not a same-pass addition alongside Phases B–F. Per the directive's explicit
fallback, this is deferred with the flag left OFF — no flag was added at all,
since introducing an inert flag for a feature with zero implementation behind
it would be dead scaffolding, not a safety control.

The existing roster tap-based check-in (Part 1) remains the correct,
already-shipped way for a coordinator to check volunteers in today; nothing
in this program changes or regresses it. Regression baseline confirmed
2026-09-02: `src/lib/labs/pta/__tests__/volunteers*.test.ts` (53 tests) and
civicflow-mobile's `volunteer-checkin/__tests__/[opportunityId].test.tsx`
(4 tests) all pass unchanged.
