# Unestra Mobile — Android Preview Build

## Configuration verified

| Item | Value | Status |
|---|---|---|
| Package name | `com.aphtechnologies.unestra` | Configured, matches iOS bundle ID |
| Keystore | Remote/EAS-managed, `Build Credentials XEl7WCwPRv` (default) | Configured, reused successfully across 3 builds this project (1 development build from an earlier pass, 2 preview builds this pass) |
| versionName | `1.0.0` | `appVersionSource: "remote"` in `eas.json` — EAS auto-increments, not hand-maintained |
| versionCode | `1` | Same remote-managed policy |
| Permissions | `android.permission.RECORD_AUDIO`, `android.permission.CAMERA` (from the `expo-camera` plugin, used for QR attendance scanning) | Present, matches actual feature use — no unused/excessive permissions requested |
| Notification permission (`POST_NOTIFICATIONS`, API 33+) | Expected to be injected automatically by the `expo-notifications` config plugin | Not independently confirmed via a local prebuild in this environment (no Android SDK/Gradle toolchain here) — standard, well-established plugin behavior in Expo SDK 54, not itself a red flag |
| Adaptive icon | Configured — foreground/background/monochrome layers all present (`assets/images/android-icon-*.png`) | Complete |
| Splash screen | Configured via `expo-splash-screen` plugin, brand blue `#208AEF` | Complete |
| Associated intent filters (App Links) | `app.getunestra.com`, `app.civicflowapp.com`, `autoVerify: true` | Configured; live verification against each domain's `assetlinks.json` not checked this pass |

## Preview builds produced this pass

Two Android preview builds were run via `eas build --platform android --profile preview --non-interactive --no-wait`, both **finished successfully**:

| Build | Commit | Result | Duration | Artifact |
|---|---|---|---|---|
| `83655609-5045-4fdb-9d0d-14095498d1f4` | uncommitted working tree at the time (PTA parity code) | Finished | ~18 min | https://expo.dev/artifacts/eas/EZuvaBxStEUE3GqzlrUqJDJYkKM4QaDLTDgp06SF588.apk |
| `df37e142-2eb0-4b56-a9d5-e9537473662d` | `ade9666` (pushed, current HEAD at time of this validation pass) | Finished | ~14 min | https://expo.dev/artifacts/eas/tVXqpPfaZEcjJYnaq6XAaD2dNKBqMFLZmJy2jraM1BM.apk |

The second build is the one this validation pass should be judged against — built from the exact commit pushed to `origin/agent/unestra-mobile-release`.

Both builds confirm the app — including PTA parent parity, PTA volunteer management, and all pre-existing conventional-member screens — bundles and packages successfully through EAS's real build pipeline (not just the local Metro dev server). Neither confirms the app runs or renders correctly, since no APK was installed on a device or emulator anywhere in this environment — see `device-test-results.md`.

## What "ready" looks like from here

Android has no outstanding credential or configuration blocker for an internal preview build. The remaining gaps are the same ones already known from the prior pass (`mobile-release-checklist.md`): Play Console Data Safety form not prepared, no physical-device or emulator test completed. Nothing in this pass changed that status — it's re-confirmed, not newly resolved.

## Command used

```bash
npx eas-cli build --platform android --profile preview --non-interactive --no-wait
```

`--no-wait` was used deliberately so other validation work could proceed in parallel; completion was polled via `eas build:view <id>` rather than blocking on the build.
