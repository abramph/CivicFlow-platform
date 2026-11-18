# Android release-readiness verification (Unestra)

This checklist documents checks still required before publishing another Google Play release. Source configuration alone is not proof that a generated AAB is compliant.

## Build and permission verification

1. Install dependencies using the repository lockfile and run mobile lint and tests.
2. Build a **release** Android artifact (EAS production or equivalent), preserving build logs and artifact identifier.
3. Inspect the release **merged manifest**, then run `node scripts/verify-android-permissions.mjs --require-merged` in the environment that produced the release manifest. This strict mode fails when no merged release manifest exists; running Expo prebuild alone does **not** meet that requirement.
4. Inspect the actual AAB/APK with Android build tools for permissions, target SDK, native shared libraries, and 16 KB page alignment/compatibility. The JavaScript manifest script does not validate 16 KB support.

## Compatibility and navigation

- Android 15 edge-to-edge: test status/navigation bar insets, keyboard, modals, scanner, and bottom actions on API 35.
- Android 16 large screens: the Expo config currently declares `orientation: portrait`. Do not remove the lock without testing screens in landscape, split-screen, and resized windows on API 36; confirm the Play Console warning against a fresh bundle.
- Android App Links: `app.getunestra.com` and `app.civicflowapp.com` are declared with `autoVerify: true`. Verify each host serves `https://<host>/.well-known/assetlinks.json` over HTTPS with the correct Android package `com.aphtechnologies.unestra` and the **Play App Signing** SHA-256 certificate fingerprint (not necessarily the upload certificate). Test verification with Android's domain verification tooling.
- Deobfuscation: determine whether the release enables R8/ProGuard and, if so, ensure the correct mapping file is uploaded or automatically delivered to Play Console.
- Confirm Play Console declarations, including trader status, using the account holder's actual business information.

## Exit criteria

- Fresh AAB produced and tested on real Android hardware or emulator (including large-screen API 36).
- No unexplained release permissions or native-library compatibility warnings.
- Both declared app-link hosts verified, or intentionally remove unused hosts after checking live routing requirements.
- Play Console warnings reassessed against the **new** artifact; screenshots/logs retained.

**Release control:** do not merge, submit, or roll out based on this checklist alone.
