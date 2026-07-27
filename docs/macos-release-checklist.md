# macOS Release Checklist — Unestra Desktop

Real results from `.github/workflows/macos-signing-notarization.yml` running on GitHub-hosted `macos-latest` runners. **Credential-blocked, not complete**: no Apple Developer ID certificate or notarization credentials are configured yet, so nothing here is actually signed, notarized, or Gatekeeper-verified — see "What's blocked" below. Everything that *can* be verified without those credentials has been, on real hardware, not just reviewed as configuration.

## Workflow runs (real, on `macos-latest`)

| Run | Trigger | Result | Duration |
|---|---|---|---|
| [30233464696](https://github.com/abramph/CivicFlow-platform/actions/runs/30233464696) | `pull_request` (initial) | ✅ success | 3m19s |
| [30233474348](https://github.com/abramph/CivicFlow-platform/actions/runs/30233474348) | `workflow_dispatch` (initial) | ✅ success | 2m52s — but see "bug found" below |
| [30233679580](https://github.com/abramph/CivicFlow-platform/actions/runs/30233679580) | `pull_request` (after fix) | ✅ success | 2m29s |
| [30233680783](https://github.com/abramph/CivicFlow-platform/actions/runs/30233680783) | `workflow_dispatch` (after fix) | ✅ success | 2m5s |

## A real bug found and fixed via this run, not caught by review alone

The first `workflow_dispatch` run "succeeded" (no step failed), but its architecture-verification and artifact-scan steps silently operated on an empty path — the "Find build outputs" step searched `release/` at `maxdepth 1` for the `.app`, but electron-builder actually nests it one level deeper (`release/mac-arm64/Unestra.app`). Fixed by widening the search to `maxdepth 2` and — more importantly — making an unresolved path a hard failure (`exit 1`) instead of a silent no-op, so this exact class of bug can't produce a false "success" again. Re-ran (30233680783) and confirmed both steps now correctly locate and inspect the real build output.

## What was verified this pass (unsigned — no certificate configured yet)

- **Desktop unit tests**: `node --test test/*.test.cjs` — 7/7 passing.
- **Lint**: `npm run lint` — reports "No linting configured" (honest status; no lint tooling exists for this plain-JS Electron app).
- **Build**: `npm run build:app && npx electron-builder --mac dmg zip --publish never` — succeeds.
- **Bundle identity, from the real built `Info.plist`**: `CFBundleIdentifier = com.civicflow.app`, `CFBundleShortVersionString = 1.0.9` — matches the authoritative identity documented in `macos-signing.md`.
- **Artifact set produced**: `Unestra-1.0.9-mac-arm64.dmg` (165MB) + `.blockmap`, `Unestra-1.0.9-mac-arm64.zip` (164MB) + `.blockmap`, `latest-mac.yml` — confirms the new `zip` target (added this pass for auto-update support) actually builds.
- **Architecture**: main executable and `better-sqlite3`'s native binary both confirmed `Mach-O 64-bit arm64`, non-fat (single-architecture) — matches the documented arm64-only decision.
- **Nested native module location**: `better-sqlite3`'s binary correctly unpacked to `Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node` (confirms the explicit `asarUnpack` config added this pass works as intended).
- **Checksums**: SHA-256 generated for both `.dmg` and `.zip`.
- **Artifact content/secret scan**: one match investigated in full — see below.
- **`codesign -dv` on the unsigned build**: `Signature=adhoc`, `TeamIdentifier=not set`, `Format=app bundle with Mach-O thin (arm64)` — exactly the expected shape for a build with no certificate imported.

## Artifact scan finding — investigated, confirmed false positive

The secret-pattern grep flagged `Contents/Resources/app.asar` for containing a `-----BEGIN RSA PRIVATE KEY-----`-shaped string. Downloaded the actual artifact and extracted the asar archive to find the exact source: it's inside `node_modules/dotenv/README-es.md` (the bundled `dotenv` package's own Spanish-language documentation), showing a **placeholder example** (`Kh9NV...`, truncated) of how to format a multiline private key in a `.env` file — not real key material, and not executable code. Confirmed via direct inspection, not assumed. Noted as scan noise, not a real secret; a future improvement would be scoping the grep away from `node_modules/**/*.md` or trimming package READMEs from the packaged app (neither done this pass — out of scope for a signing/notarization task, and not a security issue).

## What's blocked — credentials not yet configured

| Requirement | Status |
|---|---|
| `APPLE_TEAM_ID` | Missing |
| Developer ID Application certificate (`MACOS_CERTIFICATE_BASE64`) | Missing |
| Certificate password, keychain password | Missing |
| Notarization credentials (API key or Apple ID method) | Missing |

The `preflight` job confirmed this cleanly (no secret values printed, only `configured`/`missing` status) and the `release-candidate` job correctly built an **unsigned** artifact and skipped notarization, with clear `::warning::` annotations rather than silently pretending to be a release candidate. Every verification step that requires a real signature (`codesign --verify`, nested Mach-O signature enumeration, `spctl` Gatekeeper assessment, stapling) was correctly **skipped**, not faked.

## What must happen before this is a real, distributable release candidate

1. Complete `apple-credentials-setup.md` (Abram-only steps — Apple Developer account access required).
2. Add the 9 secrets listed in `macos-ci-secrets.md`.
3. Re-run `.github/workflows/macos-signing-notarization.yml` via manual dispatch.
4. Confirm the `preflight` job reports all secrets `configured`.
5. Confirm `codesign --verify --deep --strict`, `spctl --assess`, and `xcrun stapler validate` all pass on both the `.app` and `.dmg` — none of this has been exercised yet, since no certificate exists.
6. Only then, download and manually install/launch the DMG on a real Mac without bypassing Gatekeeper (`xattr -dr com.apple.quarantine` is never an acceptable step) — see the human clean-install test this pass could not perform (no Mac available in this environment).

## Auto-update readiness

- `electron-updater` is present and wired (`src/main/updater.js`), targeting this repo's own GitHub Releases feed (`provider: "github", owner: "abramph", repo: "CivicFlow-platform"`).
- Previously, the `mac` target only produced a `.dmg` — **no `.zip`**, which `electron-updater`'s Squirrel.Mac-based macOS update mechanism requires. Fixed this pass (added `zip` to `mac.target`); confirmed via this run that `Unestra-1.0.9-mac-arm64.zip` + `.blockmap` are now produced.
- Once signing is configured, auto-update will additionally require the shipped app to be code-signed for `electron-updater` to trust and apply the differential update reliably — not yet verified since no signed build has been produced.
- Whether an old, unsigned build can safely auto-update to a new signed build was not tested this pass (would require an actual old installed unsigned build to update from) — flagged as a real open question, not assumed safe.
