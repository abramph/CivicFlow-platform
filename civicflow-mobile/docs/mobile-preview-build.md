# Unestra Mobile — Preview Build Attempt

Covers the EAS `preview` build attempted for the PTA parent parity work in this pass. For overall store-readiness configuration (`app.json`, App/Play submission gaps), see `mobile-release-checklist.md`. **No build was submitted to TestFlight or Google Play** — this is an internal EAS build only, per explicit task scope.

## What was attempted

```bash
npx eas-cli build --platform android --profile preview --non-interactive --no-wait
```

- **Account**: `abramph` (also a member of `abramphs-team`), already authenticated — no new credentials were created or entered as part of this task.
- **Project**: `@abramph/unestra-mobile`, EAS project already registered from an earlier pass.
- **Credentials**: remote Android credentials + keystore already on file with Expo (`Build Credentials XEl7WCwPRv`) — reused, not regenerated. A prior Android **development** build (`dded2a8e-2b88-4a44-a2c7-c4b33a2158ec`, commit `01c5b216`) had already succeeded on this project before this pass, confirming Android build credentials were already viable.
- **This pass's build ID**: `83655609-5045-4fdb-9d0d-14095498d1f4`
- **Logs**: https://expo.dev/accounts/abramph/projects/unestra-mobile/builds/83655609-5045-4fdb-9d0d-14095498d1f4

The build was queued with `--no-wait` (returns immediately once uploaded/queued rather than blocking on the remote build) so other verification work could continue in parallel; its actual completion status should be checked at the logs URL above before treating the resulting artifact as installable.

## iOS

Not attempted this pass. Unlike Android, no prior successful iOS build exists on this project, and setting up iOS distribution credentials (Distribution Certificate + Provisioning Profile) for the first time is a more consequential, harder-to-reverse action (ties to the Apple Developer Program account) than reusing an already-configured Android keystore — outside this task's explicit scope, which prohibits beginning any signing/release-automation work. If an iOS preview build is wanted, `eas build --platform ios --profile preview` is the same command; expect an interactive credentials-setup prompt on first run.

## Why this matters for the PTA parity work specifically

This build's only purpose in this pass is to confirm the newly added PTA parent screens (`pta-report-payment.tsx`, `minutes.tsx`, `pta-documents.tsx`, and the modified `announcements`/`events`/`event/[id]`/`dues`/`dashboard`/`profile` screens) compile and bundle successfully outside of the local Metro dev server — i.e., that nothing in this pass's changes only "works" under `expo start` but fails in an actual EAS build (a different bundler/signing pipeline). It is not a substitute for installing the resulting APK on a real device or emulator and interacting with it — see `mobile-device-test-checklist.md` for why that step could not be completed in this environment, and what should happen next.
