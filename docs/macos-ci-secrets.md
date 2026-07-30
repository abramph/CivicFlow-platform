# macOS CI Secrets Reference

Exact secret names the `.github/workflows/macos-signing-notarization.yml` workflow expects. See `apple-credentials-setup.md` for how to obtain each value — this document is the quick-reference contract between that human setup process and the workflow itself. No secret values are ever recorded here or anywhere else in this repository.

## Signing (Developer ID)

| Secret | Purpose | Required for |
|---|---|---|
| `APPLE_TEAM_ID` | Your Apple Developer Team ID | Signing and both notarization methods |
| `MACOS_CERTIFICATE_BASE64` | Base64-encoded `.p12` containing the Developer ID Application certificate + private key | Signing |
| `MACOS_CERTIFICATE_PASSWORD` | The password the `.p12` was exported with | Signing |
| `MACOS_KEYCHAIN_PASSWORD` | A random password used only to protect the ephemeral CI keychain for one job run | Signing |

## Notarization — preferred (App Store Connect API key)

| Secret | Purpose |
|---|---|
| `APPLE_API_KEY_ID` | The API key's Key ID |
| `APPLE_API_ISSUER_ID` | The API key's Issuer ID (a UUID) |
| `APPLE_API_PRIVATE_KEY_BASE64` | Base64-encoded `.p8` private key file |

## Notarization — fallback (legacy Apple ID)

Only used if the API-key secrets above aren't all present.

| Secret | Purpose |
|---|---|
| `APPLE_ID` | Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password generated at appleid.apple.com |

`scripts/notarize.js` also still recognizes the pre-existing `APPLE_ID_PASSWORD` name (set by the production `build.yml` workflow) as an alias for `APPLE_APP_SPECIFIC_PASSWORD`, so that older workflow keeps notarizing without needing its secrets renamed.

## What the preflight job reports

The `preflight` job in the new workflow prints exactly this shape, for every secret above, and nothing else:

```text
APPLE_TEAM_ID: configured
Developer ID certificate (MACOS_CERTIFICATE_BASE64): configured
Certificate password (MACOS_CERTIFICATE_PASSWORD): configured
Temporary keychain password (MACOS_KEYCHAIN_PASSWORD): configured
Notarization API key ID (APPLE_API_KEY_ID): missing
Notarization API issuer (APPLE_API_ISSUER_ID): missing
Notarization API private key (APPLE_API_PRIVATE_KEY_BASE64): missing
Apple ID (legacy fallback, APPLE_ID): missing
App-specific password (legacy fallback, APPLE_APP_SPECIFIC_PASSWORD): missing
```

Never a value — only `configured` or `missing`, derived from a bash presence check (`[ -n "$SECRET" ]`) that never echoes the secret itself.

## What is deliberately NOT a GitHub secret

- The bundle identifier (`com.civicflow.app`) — not sensitive, lives in `package.json` and `src/shared/appConfig.js`.
- The GitHub token used to upload artifacts / create a draft release — uses the workflow's own automatically-provided `secrets.GITHUB_TOKEN`, scoped per-job via `permissions:` (only `release-candidate` gets `contents: write`; the other two jobs are read-only).

## Secret hygiene rules this workflow follows

- No step ever runs with `set -x` while a secret-bearing variable is in scope.
- Certificate and API key material is decoded to `$RUNNER_TEMP` (ephemeral per-job storage, not the repo, not the persistent keychain) and explicitly deleted in a `Clean up temporary keychain` step that runs with `if: always()`, even if an earlier step fails.
- The temporary signing keychain is created fresh per run and deleted at the end — it is never the runner's persistent login keychain.
- Build/notarization logs are captured to files for the artifact scan and troubleshooting, but the workflow never intentionally echoes a secret value into those logs.
