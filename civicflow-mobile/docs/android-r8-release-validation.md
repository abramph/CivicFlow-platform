# Android R8 obfuscation readiness

Google Play reports 1% obfuscation for the currently uploaded Android build. This branch enables R8 for **release builds** through an Expo config plugin (`plugins/with-android-r8.js`) rather than editing generated `android/` files. Debug builds remain unaffected.

## Verification required before merging
1. From `civicflow-mobile`, run `npx expo config --type prebuild` and `npx expo prebuild --platform android --clean --no-install` in a disposable checkout. Confirm generated `android/gradle.properties` contains `android.enableProguardInReleaseBuilds=true`, and `android/app/build.gradle` reads the property in release `minifyEnabled`.
2. Queue an Android EAS **production-profile build without auto-submission** from this branch; ensure build succeeds. Review any R8 missing-class or keep-rule errors rather than globally disabling optimization.
3. Install the optimized build and smoke-test login, organization switching, member lists, dues/payment flow, camera QR scanning, notifications, and deep links.
4. Upload a tested AAB to a Play test track, inspect Google Play's code optimization metric, and verify the obfuscation score improves. A 25%+ score is **not guaranteed** by the config change alone.
5. Keep the mapping file produced by R8 for crash deobfuscation; verify build artifact handling. Do not publish to production without review.

## Constraints
- No dependency or lockfile modifications are needed: `expo/config-plugins` is provided by the installed Expo SDK.
- This change only enables R8. Resource shrinking and Play's other Android 15/edge-to-edge warnings are separate work.
- No EAS build, Play submission, device smoke test, or optimization metric has been verified by this PR.
