# Unestra Mobile — Release Checklist

Covers iOS and Android build readiness, EAS setup, and exactly what has and hasn't been tested. **No build was submitted to TestFlight, Google Play, or any public distribution channel** — none of the steps below were executed past local/CI verification, per explicit task scope.

## Current configuration (`app.json`, confirmed present)

| Item | iOS | Android |
|---|---|---|
| Identifier | `com.aphtechnologies.unestra` | `com.aphtechnologies.unestra` |
| Display name | Unestra | Unestra |
| Version | 1.0.0 (`appVersionSource: "remote"` in `eas.json` — EAS auto-increments build number/version code, not hand-maintained here) | same |
| Icon | `./assets/expo.icon` (iOS-specific icon asset) | adaptive icon (foreground/background/monochrome layers) configured |
| Splash screen | configured (`expo-splash-screen` plugin, brand blue `#208AEF`) | same |
| Associated/App Links domains | `app.getunestra.com`, `app.civicflowapp.com` | same, via `intentFilters` with `autoVerify: true` |
| Push | `expo-notifications` plugin configured; EAS `projectId` present (`cc45ba6d-ff25-4fae-a88b-c8a543c93cab`, owner `abramph`) | same |
| Camera/Photos privacy strings | present (QR-scan and receipt-photo justifications) | N/A (Android permission strings are implicit) |
| Orientation | portrait-only | portrait-only |
| Tablet support | `supportsTablet: true` | not explicitly configured |

## Not yet configured — required before a real store submission

- **Export compliance** (`ios.config.usesNonExemptEncryption` or the App Store Connect equivalent) — not set. Required before any App Store Connect submission; not needed for an internal/EAS-only build.
- **Privacy manifest** (`PrivacyInfo.xcprivacy`) — not present. Apple has been requiring this for apps using certain "required reason" APIs; needs an audit of which SDKs in this project trigger that requirement (likely `expo-secure-store`, `expo-notifications` push token APIs) before submission.
- **Android data-safety form inputs** — not prepared (see `docs/mobile-architecture.md` and the privacy/compliance section of the program brief for the data categories this app actually collects: account info, organization membership, messages, payment metadata, volunteer records, device tokens — no student/minor-specific data is collected by the mobile app itself).
- **Sign in with Apple** — not applicable; this app's only auth method is email/password + MFA, no third-party OAuth requiring it.
- **`versionCode`/`buildNumber`** — intentionally left to EAS's remote auto-increment (`appVersionSource: "remote"`); confirm this is still the desired policy before a real release cadence begins.

## Build commands (local/CI verification only — not run to completion in this pass)

```bash
# iOS internal build (requires an Apple Developer Program account + EAS credentials setup — not attempted here)
eas build --platform ios --profile preview

# Android internal build (requires a release keystore — EAS-managed or self-provided — not attempted here)
eas build --platform android --profile preview
```

`eas.json`'s `preview` profile is already configured for `distribution: "internal"` — appropriate for the internal-testing step described below, once credentials exist.

## What was actually verified this pass

- `npx tsc --noEmit` — 0 errors.
- `npx eslint .` — 0 errors (1 warning, in a gitignored auto-generated file, not source).
- `npx jest` — 38/38 tests passing.
- `npx expo-doctor` — 17/18 checks passing (1 trivial pre-existing patch-version mismatch, unrelated to this branch).
- A full Metro bundle succeeded for both native and web targets with zero build errors, including all new PTA volunteer screens.
- The underlying API layer was verified end-to-end against a real disposable Postgres database (fresh migration, fresh seed, real bearer tokens for both a pure PTA parent and a PTA officer account) via direct HTTP requests — every new endpoint proven correct against real data, including a live discovery and fix of two genuine authentication/authorization gaps (see `mobile-architecture.md`).
- Expo's web preview target (`expo start --web`) was launched and the login screen rendered correctly in a real browser.

## What was NOT tested — physical devices and interactive UI

- **No iOS Simulator test** — this development environment is Windows; the iOS Simulator is Mac-only and was not available.
- **No physical iPhone test** — none available in this environment.
- **No Android Emulator test** — no Android emulator was configured/available in this environment.
- **No physical Android device test** — none available in this environment.
- **No interactive click-through of the rendered UI** was completed — an attempt was made via Expo's web preview target in a browser-automation tool, but React Native Web's controlled-input event handling did not respond reliably to the automation tool's synthetic input events (confirmed via the accessibility tree showing the target fields never actually received typed text, after several attempts). This is a tooling limitation of this specific session, not a defect in the app.
- **No physical device push-notification test** — push registration code was reviewed and is unchanged from the pre-existing implementation, but no new device-token round-trip was tested this pass.

**Bottom line**: the business logic and API contract are proven correct against real data. The actual rendered mobile UI, on a real device or simulator, has not been visually or interactively verified in this pass. This should be the very next step before any internal-beta distribution — ideally on a Mac with an iOS Simulator and/or a real device, or via `eas build --profile preview` once Apple/Google credentials are available, installed on a real phone.

## Remaining steps before TestFlight (not started)

1. Enroll/confirm the Apple Developer Program account is active (per the program brief, the user reports having one now).
2. Set up EAS credentials for iOS (`eas credentials`) — Distribution Certificate + Provisioning Profile, EAS-managed or self-provided.
3. Run `eas build --platform ios --profile preview` (or a dedicated `testflight` profile) and confirm the build succeeds.
4. Install the resulting build on a real device or the Simulator and complete a full interactive walkthrough (login, org-switch, volunteer browse/claim/cancel, officer check-in if a test officer account is used) — this has explicitly not happened yet.
5. Only after step 4 passes, consider `eas submit --platform ios` — not authorized or attempted in this task.

## Remaining steps before Google Play internal testing (not started)

1. Set up EAS credentials for Android (`eas credentials`) — EAS-managed upload keystore is the simplest path.
2. Run `eas build --platform android --profile preview`.
3. Install the resulting APK/AAB on a real device or emulator and complete the same interactive walkthrough as above — not yet done.
4. Prepare the Play Console's Data Safety form using the data-category list in `mobile-architecture.md`.
5. Only after step 3 passes, consider `eas submit --platform android` — not authorized or attempted in this task.
