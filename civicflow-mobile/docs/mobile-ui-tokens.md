# Mobile design tokens — incremental adoption

build-26 Phase H. Additive design-token pass, scoped deliberately narrow
per the directive's own "incremental" instruction — this is not a
mass-migration and does not touch auth or payment screens' behavior.

## What exists now

- `Spacing` (`constants/theme.ts`) — already established before this pass.
- `Colors` (`constants/theme.ts`) — light/dark surface and text colors,
  resolved via `useTheme()`. Already established.
- **New:** `ActionColors` (`constants/theme.ts`) — semantic action colors
  (`primary`, `primaryText`, `danger`, `warning`, `border`). These don't
  branch by light/dark mode; every screen that used them before this pass
  used the identical hex value in both modes already.
- **New:** `components/action-buttons.tsx` — `PrimaryActionButton` (the
  large solid centered button) and `SecondaryLinkButton` (the text-link
  secondary action), consolidating a style block that was independently
  hand-rolled per screen.

## Why now

A repo-wide grep found the same few hex values hardcoded across 40+ files:
`#047857` (112 occurrences), `#D0D5DD` (65), `#B42318` (50), plus two
slightly different ambers — `#B54708` (5 places) and a one-off drift,
`#B45309`, in `attendance-scan.tsx` alone. The drift is exactly the failure
mode a token exists to prevent, so it was corrected as part of introducing
`ActionColors.warning` (see that file's `lateBadge` style).

## What this pass actually touched

- `constants/theme.ts` — added `ActionColors` (additive, nothing removed).
- `components/action-buttons.tsx` — new file.
- `pta-family-photo.tsx` (Phase F, this same program) — migrated to the new
  button components and `ActionColors.danger`, as the first real adopter.
- `attendance-scan.tsx` — one line (`lateBadge`'s color), fixing the amber
  drift. No other change to that file in this pass; its permission-copy
  correction is a separate, later phase (Phase I) of this same program.

## What this pass deliberately did NOT touch

The other 200+ hardcoded occurrences across admin/member/HOA/union screens,
`login.tsx`, `mfa-challenge.tsx`, `accept-invite.tsx`, `payment-history.tsx`,
`report-payment.tsx`, and the rest of the app. Migrating those is real,
valuable follow-up work, but doing it in the same pass as three other
security/feature phases would turn a token-introduction change into a
sprawling, hard-to-review diff across auth and payment surfaces the
directive explicitly asked not to risk. Adopt incrementally, screen by
screen, as those screens are touched for other reasons — same approach
already used for other partial-rollout follow-ups in this codebase (e.g.
the auth-form hydration fix's "43/51 forms still lack an explicit method"
note).

The small inline roster action buttons in
`volunteer-checkin/[opportunityId].tsx` (multiple compact buttons per row,
outline/danger variants) are a different visual pattern from
`action-buttons.tsx`'s large centered shape and were deliberately left
alone rather than forced into the same component — a future token pass for
that shape should introduce its own small-button component, not stretch
this one to cover both.
