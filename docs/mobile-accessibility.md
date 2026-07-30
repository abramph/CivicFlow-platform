# Unestra Mobile — Accessibility Baseline

## Starting point

`civicflow-mobile/docs/mobile-beta-validation.md` and `device-test-results.md` (from an earlier pass) found zero `accessibilityLabel`/`accessibilityRole`/`accessibilityHint` anywhere in the mobile codebase. Font scaling was never disabled and contrast ratios already passed WCAG AA; orientation was already deliberately locked to portrait (documented, unchanged). This document covers the pass that added the missing screen-reader/label coverage.

## What changed

Added `accessibilityRole`, `accessibilityLabel`, `accessibilityState` (selected/disabled/busy), and `accessibilityHint` where useful, plus live-region behavior for async errors/success states, across every interactive screen in the app:

- **Navigation**: tab bar (`tabBarAccessibilityLabel` per tab, including unread-count context on Inbox), organization switcher (selected state, delinquent flag).
- **Auth funnel**: login, MFA challenge (including the SMS-fallback path), accept-invite — labeled fields, `accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"` on error text so a screen reader announces failures without the user having to find them.
- **Dashboard**: every summary tile, quick-action button, and list card — composed into a single coherent label per `Pressable` rather than letting a screen reader read each child `Text` separately (avoids duplicate/fragmented speech).
- **Announcements & Events**: list rows, detail pages, and the RSVP control (`accessibilityRole="radiogroup"`/`"radio"` with `accessibilityState={{selected}}` — proper radio-group semantics, not just visually-styled chips).
- **Dues & payments**: balance cards, all three payment-report forms (conventional, PTA-only, and the shared `PaymentOptions` component used by all three "Make a Payment" sub-screens), payment method/category chips as radio groups, receipt photo picker.
- **Volunteers**: opportunity browse/signup/cancellation, the event-day check-in/check-out roster (every action labeled with the volunteer's name — this screen is used one-handed at events), hour approvals.
- **Inbox**: conversation list (unread state), message thread (each bubble labeled with sender + timestamp), composer and send button.
- **Profile**: name/email/org display, organization switch, attendance history, notification toggles (each `Switch` now has an explicit label — React Native doesn't infer one from adjacent text), logout.
- **Minutes & Documents**: list rows grouped into single accessible reads.
- Loading states (`accessibilityRole="progressbar"`) and not-found states (`accessibilityRole="alert"`) added consistently across detail screens.

## Deliberately not done

- No new confirmation dialogs were added for destructive actions (e.g., logout, cancel signup) — the existing UX flow wasn't changed, only labeled. Adding new confirmation prompts is a product decision, not an accessibility-labeling one.
- The root `_layout.tsx` (pure `Stack` navigator config) and `payments.tsx`/`index.tsx` (pure redirects with a loading spinner) needed no interactive labeling beyond the loading indicator.

## Verification

`npx tsc --noEmit`, `npx expo lint`, and `npx jest` (50/50) all pass clean after these changes — same as the pre-existing baseline, no regressions.

**Not verified in this pass** (unchanged limitation from every prior mobile pass): no physical device, iOS Simulator, or Android emulator is available in this Windows environment, so none of this was confirmed with an actual screen reader (VoiceOver/TalkBack). This is static-analysis-verified (props are present and correctly wired) but not device-verified. The next physical-device pass should specifically enable a screen reader and re-walk the PTA parent and conventional-member scripts from `device-test-results.md`.
