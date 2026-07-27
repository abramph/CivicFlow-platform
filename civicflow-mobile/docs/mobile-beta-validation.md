# Unestra Mobile — Internal Beta Validation

## Scope

An end-to-end validation pass across the mobile app as it stands after PR #21 (PTA Volunteer Management) and PR #22 (PTA parent mobile parity) — no new features were built in this pass. Two known, deliberately-deferred gaps from PR #22 (a parent-facing meetings/agenda list, and Profile comms-preference editing) remain out of scope, unchanged. This document is the index; see the companion documents for full detail:

- **`testflight-readiness.md`** — Apple Developer / iOS signing configuration audit and verdict.
- **`android-preview.md`** — Android configuration audit and this pass's two successful EAS preview builds.
- **`device-test-results.md`** — the PTA parent and conventional-org walkthroughs, accessibility findings, and performance measurements, with an explicit accounting of what could and couldn't be verified in this environment.

## Environment constraint, stated once

This is a Windows environment with no Mac, no iOS Simulator, no physical iPhone, no Android emulator, and no physical Android device. This constraint is not new to this pass — it has applied to every prior mobile pass in this project — and it shapes what "verified" means throughout these documents: real HTTP-level and configuration-level verification was performed thoroughly; on-device rendering, interaction, and screen-reader verification could not be performed at all, anywhere, in this pass.

## Phase-by-phase summary

| Phase | Result |
|---|---|
| 1. Project audit | Expo SDK 54.0.0, React Native 0.81.5, React 19.1.0. `eas.json`/`app.json` fully reviewed. See "Missing items" below. |
| 2. Preview builds | Android: **2 successful builds** this pass (see `android-preview.md`). iOS: **stopped per instructions** — no distribution credentials exist; did not attempt to create any. |
| 3. Apple Developer validation | **Not ready.** No Team, no Distribution Certificate, no Provisioning Profile, no export-compliance flag. Full detail in `testflight-readiness.md`. |
| 4. Android validation | **Ready for internal preview builds.** Package name, keystore, versioning, icons, splash all configured and proven via 2 real successful builds. |
| 5. PTA parent walkthrough | **18/18 steps passed** via real API calls against a real disposable database (Pine Grove, Casey Kim). One honest gap: MFA not exercised (no MFA-enabled PTA-parent seed account exists). |
| 6. Conventional org walkthrough | **Zero PTA leakage confirmed** into Riverdale, at the route level, for a real cross-org identity. One honest gap: no seeded conventional `MEMBER`-role login exists for Riverdale, so a full member-experience UI walkthrough there wasn't possible. |
| 7. Push notifications | **Real gap found, since fixed.** Push notifications (announcements, payment-report approval, inbox messages) could not reach a PTA parent's device — `sendPushToMember()` resolved target devices via the shared household `OrgMember.userId`, which is never set for a household billing identity. Fixed via `resolvePtaHouseholdAdultUserIds()` (a household-adult fallback) plus a direct-userId path for Inbox (which never went through `sendPushToMember` in the first place). Verified against a real disposable database: a real device token registered for a seeded PTA parent is now correctly found and attempted, where before the fix it reported "No linked mobile login." See below. |
| 8. Accessibility | Static analysis only. Real gap found: zero explicit accessibility props anywhere in the codebase. Positive findings: font scaling never disabled, contrast ratios all pass WCAG AA. Landscape is definitively unsupported (locked in config). |
| 9. Performance | Only API latency was measurable (7–9ms locally, not representative of production). Cold/warm launch, memory, and large-list rendering require a device and were not measured. |
| 10. Security | **Every tested path failed closed**: cross-org navigation, tampered/garbage IDs, malformed and missing tokens, a deactivated household (immediate effect on the very next request with a still-valid token), and disabled PTA Labs enrollment. One minor finding: org-discovery's `pta` field isn't itself gated by Labs-enrollment status (though every actual data route still correctly fails closed), which could show a Volunteer tab that then errors if Labs is disabled mid-session. |

## Push-notification gap — found during validation, fixed on request

This was initially treated as a documentation finding rather than a fix, per this task's original instruction ("do not implement new features unless a real validation failure requires it") and Phase 7's own instruction ("document unsupported functionality honestly"). It was subsequently fixed on explicit request. The fix does not invent a new preference model: it reuses the household's existing shared `commsPushEnabled`/`requiredNoticesOnly` settings for the announcement/payment-report path (applied equally to every adult, since no per-adult preference model exists), and sends unconditionally for Inbox messages (matching the fact that no per-adult opt-out surface exists for that channel either). See `civicflow-portal/src/lib/push.ts` and `messaging.ts` for the exact change, and their test files for coverage.

## Missing configuration items (Phase 1, consolidated)

- iOS: Apple Team ID, Distribution Certificate, Provisioning Profile, APNs key, `ITSAppUsesNonExemptEncryption`, `PrivacyInfo.xcprivacy`.
- Both platforms: Associated Domains / App Links are declared in config but were not independently re-verified against a live `apple-app-site-association` / `assetlinks.json` on `app.getunestra.com` this pass (out of scope — no domain changes were made or suspected).
- Neither platform is missing anything required for an **internal EAS preview build** — Android's absence of blockers is why its preview build succeeded twice this pass.

See `docs/mobile-pta-parent-parity.md` and `docs/mobile-pta-api-matrix.md` (from the prior pass) for the PTA-specific feature-level documentation this validation pass builds on.
