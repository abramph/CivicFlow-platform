# Mobile Beta Readiness Checklist

Where `civicflow-mobile` (the Expo/React Native app, same monorepo as this portal) actually stands
for a real beta release, checked 2026-08 as part of the production readiness program. This is a
factual status check, not a plan to build the missing pieces — several of the gaps below require
the user's own Apple Developer account action and cannot be completed by an agent.

## Android — ready

- Package identifier, keystore, and versioning are configured (`app.json`'s `android` block,
  `com.aphtechnologies.unestra`).
- Adaptive icon set (foreground/background/monochrome) is present and correctly wired.
- App links (`intentFilters` for `app.getunestra.com`/`app.civicflowapp.com`) are configured.
- EAS project is registered (`extra.eas.projectId` in `app.json`, owner `abramph`).
- Confirmed via `npx expo-doctor`: 18/18 checks pass (as of this pass — a patch-level `expo` package
  mismatch was found and fixed during this readiness pass; re-run `expo-doctor` before any release
  build to confirm it's still clean).
- Prior preview builds via EAS have completed successfully (2 confirmed in earlier work).

**Android can go to an internal/closed beta track today** without any further blocking work.

## iOS — not ready, and none of these gaps can be closed without the user's own Apple account

- **No Apple Developer Team ID configured.** `app.json`'s `ios` block has no `appleTeamId`; EAS
  cannot produce a signed build without one.
- **No distribution certificate or provisioning profile exist.** These are created against a real
  Apple Developer Program membership (paid, $99/year, requires the account owner's own
  identity/business verification) — this is not something that can be generated from this
  environment.
- **No export-compliance flag set.** Apple requires declaring the app's use of encryption
  (`ITSAppUsesNonExemptEncryption` in `app.json`'s `ios.infoPlist`, or answering the equivalent
  question in App Store Connect) before a TestFlight build can process. Not set today.
- **No `PrivacyInfo.xcprivacy` manifest.** Apple has required this for apps using certain
  "required reason" APIs (a category that generically includes things like `UserDefaults`,
  used transitively by several Expo/React Native modules) since 2024 — confirmed absent from the
  project (`find . -iname PrivacyInfo.xcprivacy` returns nothing). A build without it may be
  rejected or flagged during App Store/TestFlight processing.
- iOS `associatedDomains` (`applinks:app.getunestra.com`/`app.civicflowapp.com`) is already
  configured correctly in `app.json` — this part is ready whenever the above account-level items
  are resolved.

**What the user needs to do, in order, before an iOS beta is possible:**
1. Enroll in (or confirm existing enrollment in) the Apple Developer Program.
2. Note the Team ID from developer.apple.com and add it to `app.json`'s `ios.appleTeamId`.
3. Run `eas build --platform ios` — EAS can generate the distribution certificate/provisioning
   profile automatically once a real Team ID and Apple account credentials are available
   interactively (this requires the user to authenticate with Apple directly during the build; an
   agent cannot do this on the user's behalf per this program's own credential-handling
   constraints).
4. Add a `PrivacyInfo.xcprivacy` manifest (Expo's config plugin ecosystem has a documented pattern
   for this — the config plugin, not a manually-maintained file, is the more maintainable path
   given how frequently the underlying "required reason API" list changes).
5. Answer the export-compliance question (most apps using only standard HTTPS/TLS qualify for the
   exemption — verify this app doesn't use any additional cryptography beyond that before assuming
   the exemption applies).

## Cross-platform readiness (both platforms)

- Expo SDK 54 confirmed compatible with the publicly-installed Expo Go app (downgraded from SDK 57
  earlier for this reason — see prior mobile-compatibility work) — testers can use Expo Go for
  early internal testing without a custom dev client, on both platforms.
- `docs/mobile-accessibility.md` — screen-reader/label coverage added across every interactive
  screen; **not yet device-verified** with an actual screen reader (VoiceOver/TalkBack) since no
  physical device or simulator/emulator is available in this environment. This is the single
  highest-value pre-beta verification step once a real device is available.
- Mobile client's vertical-capability awareness (`MobileOrganization` type in `src/lib/
  auth-context.tsx`) was previously stale — it silently discarded the server's per-vertical
  `capability` data. Fixed this pass: the type now carries it, and the org switcher surfaces a
  vertical label (e.g. "HOA", "PTA") per organization.

## Bottom line

Android can proceed to a real internal beta now. iOS is blocked entirely on Apple Developer account
setup that only the account owner can perform — flag this explicitly rather than treating "mobile
beta" as a single go/no-go: it's a go for Android, a no-go for iOS pending user action.
