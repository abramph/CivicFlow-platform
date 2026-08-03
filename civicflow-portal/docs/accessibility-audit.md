# Web Portal Accessibility Audit

Static, code-level audit of `civicflow-portal` (the staff/member web app) as part of the production
readiness program — 2026-08. Mobile accessibility is tracked separately in
`docs/mobile-accessibility.md` (already remediated in an earlier pass).

**Method**: static code reading only — no browser/screen-reader available in this environment. This
finds structural gaps (missing labels, landmarks, keyboard handlers) but does **not** substitute for
an actual screen-reader walkthrough (VoiceOver/NVDA/JAWS) or a rendered-contrast check before this
app takes on customers who rely on assistive technology. Treat every item below as "confirmed in
code" but "not device-verified."

## Fixed in this pass

- **MFA/Security settings page unlabeled inputs** (`src/app/settings/security/page.tsx`) — the
  authenticator confirmation code, SMS backup phone number, SMS verification code, and the
  MFA-disable password confirmation all relied on placeholder text only, with no programmatic
  label. Added `aria-label` to each. This was the highest-priority fix here since it sits directly
  in a security-critical flow (screen-reader users could not previously identify these fields at
  all).
- **Missing `<main>` landmark on the member-facing shell** (`src/components/app/
  MemberPortalShell.tsx`, used by every `/m/*` route) — every member-portal page rendered with no
  `<main>` landmark at all, only `<header>`/`<nav>`. Added `<main id="main-content">`.
- **No skip-to-content link anywhere** (`src/app/layout.tsx`) — added one, targeting
  `#main-content` (now present on both the staff shell's `<main>` in `PortalShell.tsx` and the
  member shell's in `MemberPortalShell.tsx`). It has no effect on the handful of full-bleed
  "hidden path" pages (login, signup, accept-invite, etc. — see `isHiddenPath()` in
  `PortalShell.tsx`) that render with no shell `<main>` at all; those pages are short, single-form
  flows where a skip link matters less, and adding a landmark to each individually was left out of
  this pass's scope.
- **Import dropzone unreachable by keyboard** (`src/components/import/ImportPageClient.tsx`) — the
  drag-and-drop file upload target was a bare `<div onClick>` with no keyboard path to the hidden
  file input at all. Added `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space), an
  `aria-label`, and a visible focus ring.

## Confirmed gaps, not fixed in this pass (documented for follow-up)

These are real but lower-urgency relative to this pass's Critical/High bar, and some require a
broader change than a single bounded readiness pass should make unilaterally:

- **Low-contrast text (`text-slate-400`, ~2.85:1 on white)** used in genuinely informative (not
  placeholder) text in several places — e.g. `MfaChallengeContent.tsx:176,196` (redirect/countdown
  text), `AttendanceFullScreenDisplay.tsx:96,110`, `ForgotPasswordForm.tsx:47`. This is a real WCAG
  AA contrast failure risk (need ≥4.5:1 for normal text), but fixing it means either a design-system
  color change or per-instance overrides — a decision that touches visual design broadly and
  deserves a deliberate pass with design sign-off, not a scattered mechanical find-and-replace.
- **No focus trap / return-focus / Escape handling on any overlay** — no dialog/modal library is
  used anywhere in the codebase (confirmed: zero `role="dialog"`, `aria-modal`, or Escape-key
  handling in `src`). The ad-hoc overlays that exist (e.g. `AttendanceSessionManager.tsx`'s
  correction modal, `MemberPortalShell.tsx`'s mobile nav drawer) are keyboard-trap risks for
  screen-reader and keyboard-only users. Fixing this properly means introducing a real
  dialog/modal primitive with correct focus management — a real piece of new UI infrastructure, not
  a quick patch, and out of scope for this pass.
- **Form errors/notices aren't announced to screen readers** — validation and status messages
  across login/signup/security-settings render as plain `<p>` with no `role="alert"`/`aria-live`,
  so a screen-reader user isn't notified when one appears without a page navigation. `Impersonation
  Banner.tsx` already does this correctly (`role="status" aria-live="polite"`) — that's the pattern
  to extend everywhere else, in a dedicated follow-up.
- **No automated accessibility test coverage at all** — no `jest-axe`/`axe-core`, no
  `@testing-library/*`, and no `.test.tsx` files exist; `vitest.config.ts` runs in a plain Node
  environment with no DOM, so there is currently no way to even render a component under test.
  Adding this is a real, valuable investment (jsdom + testing-library + jest-axe), but it's new test
  infrastructure, not a bug fix — a decision for a dedicated follow-up rather than something to bolt
  on inside this readiness pass.

## Recommended before onboarding any organization that has staff/members relying on assistive tech

1. A real screen-reader walkthrough (VoiceOver on macOS/iOS Safari, or NVDA on Windows) of the core
   flows: login, MFA setup/challenge, member creation, dues payment, CSV import.
2. A rendered-contrast check (browser DevTools' own contrast checker, or a tool like Lighthouse) to
   confirm the `text-slate-400` instances above against their actual backgrounds.
3. Prioritize the modal/dialog focus-trap fix if any organization's staff workflow depends heavily
   on the attendance-correction modal or similar overlay-heavy screens.
