# macOS Notarization — Unestra Desktop

## What notarization is, briefly

Apple's automated malware scan of a signed app, run after signing and before distribution. Gatekeeper (macOS's launch-time security check) will refuse to open an unnotarized, downloaded app with an "unidentified developer" or "damaged" warning — notarization plus stapling is what makes a Developer-ID-signed app open cleanly on someone else's Mac without bypassing security.

## Method: `notarytool` via `@electron/notarize`

`scripts/notarize.js` (an electron-builder `afterSign` hook, so it runs automatically as part of `npx electron-builder --mac ...`) calls `@electron/notarize`'s `notarize()` function, which itself uses Apple's current `notarytool` under the hood — **not** the deprecated `altool`, which Apple stopped accepting submissions from in late 2023.

### Preferred: App Store Connect API key

```js
await notarize({
  appBundleId: APP_ID, // "com.civicflow.app", from src/shared/appConfig.js
  appPath,
  appleApiKey: apiKeyPath,   // a file path, decoded from APPLE_API_PRIVATE_KEY_BASE64 by CI
  appleApiKeyId: apiKeyId,   // APPLE_API_KEY_ID
  appleApiIssuer: apiIssuerId, // APPLE_API_ISSUER_ID
});
```

### Fallback: Apple ID + app-specific password

Used only if the API-key secrets aren't all present — kept so the existing production `build.yml` workflow (which still sets the legacy `APPLE_ID`/`APPLE_ID_PASSWORD`/`APPLE_TEAM_ID` variables) doesn't silently stop notarizing.

## Sequence (matches Apple's required flow)

1. electron-builder builds and signs the `.app`.
2. `afterSign` hook (`scripts/notarize.js`) runs, submitting the signed `.app` to `notarytool` and waiting synchronously for a result (`notarize()` blocks until Apple responds — equivalent to `notarytool submit ... --wait`).
3. `@electron/notarize`'s `notarize()` call also staples the ticket to the `.app` automatically on success, as part of the same call.
4. electron-builder then packages the (already notarized + stapled) `.app` into the `.dmg` and `.zip` targets.
5. The workflow's own explicit `xcrun stapler staple`/`validate` step additionally staples and validates the **`.dmg` file itself** — the `.app`-level stapling above doesn't cover the DMG container, and Gatekeeper checks the DMG at mount time too.

## What the workflow captures as evidence

- Full build+notarize stdout/stderr → `$RUNNER_TEMP/build-and-notarize.log`, uploaded as a workflow artifact.
- A filtered `notarization-result.txt` (grep for notarization/submission/id/status/message lines) — this is the human-readable notarization result, not just "the build succeeded."
- Separate staple logs for the `.app` and `.dmg`.

## Only acceptable success state

Apple's returned status must be exactly `Accepted`. `notarize()` throws on rejection, which fails the electron-builder build step outright (`set -eo pipefail` in the workflow ensures this isn't silently swallowed) — there is no code path that reports success on anything less than an accepted submission.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Skipping notarization: no Apple credentials configured` | Neither the API-key nor legacy secret set is fully present — check `preflight` job output in `macos-ci-secrets.md`. |
| Notarization rejected, log mentions unsigned nested binary | A native module or helper wasn't signed with the same Developer ID as the main app. Check the workflow's "Enumerate and verify nested Mach-O binaries" step output. |
| Notarization rejected, log mentions Hardened Runtime | `hardenedRuntime: true` is already set in `package.json`; if this still triggers, check whether a bundled binary lacks the runtime flag (`codesign -dv` on it directly). |
| `xcrun stapler staple` fails on the DMG | The `.app` inside the DMG must already be notarized+stapled first (it is, automatically, by step 3 above) — a failure here usually means the notarization step itself didn't actually succeed; check `notarization-result.txt`. |
| Notarization times out / hangs | Apple's notarization service occasionally has delays measured in tens of minutes; `notarize()`'s `--wait`-equivalent behavior can take a while under load. Not a workflow bug by itself — check Apple's System Status page if it consistently exceeds ~30 minutes. |

## This pass's real result

See `macos-release-checklist.md` and the final report for the actual submission ID, status, and workflow-run URL from a real `macos-latest` GitHub Actions run.
