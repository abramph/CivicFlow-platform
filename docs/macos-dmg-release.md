# macOS DMG Release — Unestra Desktop

## DMG configuration

```json
"dmg": {
  "title": "${productName} ${version}",
  "window": { "width": 540, "height": 380 }
}
```

Artifact filename pattern: `${productName}-${version}-mac-${arch}.${ext}` → e.g. `Unestra-1.0.9-rc.3-mac-arm64.dmg` for a release-candidate build from this pipeline (the `-rc.<run number>` suffix is applied only at build time via `-c.extraMetadata.version`, never written back to the committed `package.json` — see "Versioning" below).

## Contents

electron-builder's default DMG layout for a `dmg` target with no custom `contents` array is the standard one: the `.app` plus a symlinked shortcut to `/Applications`, arranged in the configured window size, using the app's own icon. This repository doesn't currently customize the icon positions or background image beyond the default — a reasonable, unpolished-but-functional starting point; a custom `background` image and explicit icon `x`/`y` positions would be the next visual-polish step if a more "designed" DMG is wanted later.

## What must never end up inside the app or DMG

Checked by the workflow's "Artifact content and secret scan" step, which searches the packaged `.app`'s `Contents/Resources` for:

- `.env`* files
- `.pem`, `.p12`, `.p8` files
- anything with "credential" in the name
- `.map` source-map files
- obvious secret-shaped strings (`sk_live_...`, AWS access-key patterns, PEM private-key headers)

The electron-builder `files` allowlist in `package.json` already only includes `dist/**/*` (the built renderer bundle), `assets/**/*`, `src/db/**/*`, `src/main/**/*`, `src/shared/**/*`, the two entry files, and `package.json` itself — it does **not** include `.env`, `test/`, `scripts/`, or any repository metadata, so none of that should ever reach the packaged app in the first place. The scan step exists to catch a regression in that allowlist, not because a leak is expected.

## Source maps

Not currently generated for the renderer build (`vite build` defaults to no source maps unless `build.sourcemap` is set in `vite.renderer.config.mjs`, which it isn't). This means production stack traces are harder to debug from a crash report, but it also means no source code shape is shipped inside the DMG — a deliberate, if implicit, tradeoff. Not changed this pass since it's outside signing/notarization/packaging scope.

## Versioning

- **Authoritative version source**: `package.json`'s `version` field (`1.0.9` at the time of this pass), consumed identically by the app itself (`APP_VERSION` in `appConfig.js`), electron-builder's artifact naming, and the auto-updater's version comparison.
- **This pipeline never overwrites that committed value.** Every release-candidate build from `.github/workflows/macos-signing-notarization.yml` instead passes `-c.extraMetadata.version=<pkg-version>-rc.<github-run-number>` directly to the `electron-builder` CLI invocation, which only affects the build's own in-memory metadata and output filenames for that run — `package.json` on disk is untouched.
- **Why**: `1.0.9` has already been distributed publicly (per `build.yml`'s own comment referencing a real "v1.0.9 release"). Reusing that exact version number for an unrelated release-candidate artifact would create real ambiguity about which binary a user actually has. The `-rc.N` suffix makes every candidate from this pipeline unambiguous and traceable to the exact GitHub Actions run that produced it.

## Artifact integrity

The `release-candidate` job generates `release/checksums-sha256.txt` via `shasum -a 256` over every `.dmg`/`.zip` produced, uploaded alongside the artifacts themselves.

## Distribution — explicitly not done by this pipeline

- No public GitHub Release is published automatically. The `create_draft_release_candidate` input, when explicitly set to `true`, creates a **draft** release only (invisible to the public until a human manually publishes it) tagged `rc-<version>` — distinct from real release tags (`v*`), which is what the production `build.yml` workflow still watches.
- No WordPress or marketing-site download link is touched by this pipeline.
- The primary output of a normal run is the **private workflow artifact** — downloadable only by someone with repository access, via the Actions run page, and automatically expired after the configured retention window (30 days for release-candidate builds, 14 for PR-validation builds).
