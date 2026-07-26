# Unestra Mobile — TestFlight Readiness

**Verdict: NOT READY for TestFlight.** No iOS distribution credentials exist for this project at all. This document records exactly what is missing, verified by directly attempting `eas build --platform ios --profile preview --non-interactive` (chosen specifically because non-interactive mode fails cleanly with a precise reason instead of prompting to create new credentials).

## What was checked

| Item | Status | Evidence |
|---|---|---|
| Bundle Identifier | **Configured** — `com.aphtechnologies.unestra` | `app.json` → `ios.bundleIdentifier` |
| Apple Team | **Missing** | No Apple Team ID appears anywhere in `app.json`, `eas.json`, `.env`, or EAS project credentials. `eas build --platform ios --non-interactive` reports no suitable credentials exist — team enrollment has never been linked to this EAS project. |
| Signing Certificate (Distribution) | **Missing** | Same build attempt: "EAS CLI couldn't find any credentials suitable for internal distribution." No Distribution Certificate has ever been generated or uploaded for this project. |
| Provisioning Profile | **Missing** | Depends on the certificate above; neither exists. |
| Push capability (APNs key/cert) | **Not configured** | No APNs authentication key on file; cannot be configured before a Team/certificate exist. `expo-notifications` plugin is present in `app.json`, so the client-side integration is ready — only the Apple-side credential is missing. |
| Associated Domains | **Configured** | `app.json` → `ios.associatedDomains`: `applinks:app.getunestra.com`, `applinks:app.civicflowapp.com`. Not yet verified against a live `apple-app-site-association` file on either domain (not checked this pass — see `mobile-beta-validation.md`). |
| Background Modes | **Not configured** | No `UIBackgroundModes` key present. Not required for the app's current alert-style push notifications; would only matter for background fetch or silent push, neither of which this app uses today. |
| Export compliance | **Missing** | `eas build` itself flags this: `app.json is missing ios.infoPlist.ITSAppUsesNonExemptEncryption boolean. Manual configuration is required in App Store Connect before the app can be tested.` |
| Privacy manifest (`PrivacyInfo.xcprivacy`) | **Not present** | Not checked in detail this pass (was already flagged in the prior `mobile-release-checklist.md`); still needed before any real submission. |

## Why this wasn't fixed

Setting up an Apple Distribution Certificate and Provisioning Profile for the first time is a consequential, harder-to-reverse action tied to the Apple Developer Program account (`eas credentials` in interactive mode would generate/upload new signing material). This task's explicit scope draws the line here: the next engineering phase (explicitly listed by the task brief) is macOS code signing, notarization, and TestFlight submission — this validation pass's job was to identify precisely what's missing, not begin that work.

## Exact blockers, in order

1. Confirm the Apple Developer Program account is active and enrolled (per prior project memory, the user reports having one now — not independently re-verified this pass).
2. Run `eas credentials` interactively for iOS, select "internal distribution," and let EAS generate or link a Distribution Certificate + Provisioning Profile (or provide existing ones).
3. Add `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` (or `true` with justification) to `app.json` — the app uses only standard HTTPS/TLS, so `false` is almost certainly correct, but this is a product decision to confirm, not assumed here.
4. Re-run `eas build --platform ios --profile preview` — should succeed once 1–3 are done.
5. Only after a successful preview build has been installed and verified on a real device (see `device-test-results.md`), proceed to a TestFlight-specific build/submission — explicitly the next phase, not this one.

## What already works and needs no further setup

- The Android side (package identifier, keystore, remote versioning) is fully configured and has produced two successful preview builds this pass — see `android-preview.md`.
- All client-side code (auth, PTA parent parity, push registration, deep links) is platform-agnostic and requires no iOS-specific changes once credentials exist.
