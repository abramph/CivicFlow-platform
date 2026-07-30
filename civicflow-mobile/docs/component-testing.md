# Unestra Mobile — Component Test Infrastructure

## What was added

No component-rendering test infrastructure existed before this pass (confirmed in `mobile-pta-parent-parity.md`: "UI verification is limited to type-checking, linting, a successful bundle, and real-HTTP proof"). Added the smallest maintainable foundation using tooling already compatible with this project's Expo SDK 54 / React 19.1.0 / React Native 0.81.5 stack:

- `@testing-library/react-native@14.0.1` + its `test-renderer@1.2.0` peer (the React-19-era replacement for the deprecated `react-test-renderer`).
- `jest.setup.js` (`setupFilesAfterEnv`) — sets `global.IS_REACT_ACT_ENVIRONMENT = true` so React's concurrent-act warnings don't fire spuriously.
- `jest.css-mock.js` (`moduleNameMapper` for `\.css$`) — `theme.ts` imports `global.css` for the web/NativeWind target; Jest can't parse raw CSS, so it's mapped to an empty module.
- `testMatch` extended to include `*.test.tsx` (previously `.ts` only, which silently would have excluded every component test).

Existing `.test.ts` unit tests (mobile-api, unread-count, deep-links) are untouched and still pass.

## The one non-obvious API change to know

**RNTL v14's `render`, `fireEvent`, and `fireEvent.<event>` are all `async`.** Every call must be `await`ed:

```tsx
const result = await render(<Component />);
await fireEvent.press(screen.getByLabelText('Submit'));
await fireEvent.changeText(screen.getByLabelText('Amount'), '25.00');
```

Forgetting the `await` doesn't throw — `render()` silently returns a `Promise` (which destructures to `{}`), and an un-awaited `fireEvent.press` on a handler with an `await` inside will fire but the assertion right after it will read stale state. This bit every new test file during this pass; a few `waitFor(...)` calls masked it enough to eventually pass, but plain `await` is the correct, simplest fix.

## Tests added (13 files, 74 tests total — up from 50 pre-existing unit tests)

- `src/__tests__/smoke.test.tsx` — proves the harness itself works.
- `src/app/(tabs)/__tests__/dues.test.tsx` — dues-status rendering for both the conventional-member and PTA-parent identity, including the past-due and no-billing-record states.
- `src/app/(tabs)/__tests__/announcements.test.tsx` — unread vs. read announcements collapse into one accessible label each.
- `src/app/(tabs)/__tests__/inbox.test.tsx` — unread conversation state, empty state.
- `src/app/(tabs)/__tests__/volunteers.test.tsx` — PTA capability gating: the volunteer hub renders for a household adult and is fully hidden (with zero API calls) when the organization has no PTA identity at all — the client-side half of "Labs removal fails closed."
- `src/app/event/__tests__/[id].test.tsx` — RSVP renders as a real `radiogroup`/`radio` with correct `selected` state, and tapping a different option submits it.
- `src/app/volunteer-opportunity/__tests__/[id].test.tsx` — claiming an open shift, the disabled "full" state, and cancelling an existing signup.
- `src/app/volunteer-checkin/__tests__/[opportunityId].test.tsx` — the event-day roster's check-in → check-out → attendance-recorded state progression.
- `src/app/__tests__/org-switcher.test.tsx` — selecting a different organization (navigates to `/dashboard`), selected-state marking, and logout.
- `src/app/__tests__/pta-report-payment.test.tsx` — client-side amount validation (rejects empty/zero) and the success confirmation after a valid submission.

## Deliberately not built

- No snapshot tests — they test rendered markup, not behavior, and rot silently on refactors.
- No visual/screenshot regression tooling — out of scope for "smallest maintainable" and this environment has no device/simulator to render against anyway.
- Navigation-container-level tests of `(tabs)/_layout.tsx`'s tab visibility were not attempted directly (would require mounting a full React Navigation tree); the equivalent behavior — a screen fully hiding itself and making zero API calls when the caller has no PTA identity — is covered instead via `volunteers.test.tsx`, which is the more direct and more maintainable assertion of the same guarantee.

## Verification

`npx tsc --noEmit`, `npx expo lint`, and `npx jest` (74/74) all pass clean. `npx expo-doctor` shows one pre-existing, unrelated patch-version drift (`expo` 54.0.35 vs. 54.0.36) — not introduced by this work, and dependency version bumps are out of scope here.
