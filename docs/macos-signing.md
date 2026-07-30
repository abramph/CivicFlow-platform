# macOS Code Signing — Unestra Desktop

## Identity

- **Bundle identifier**: `com.civicflow.app` — deliberate and permanent (see `src/shared/appConfig.js`'s explicit "DO NOT change" comment: this drives `app.setName()`, which determines the macOS `userData` folder existing installs' local SQLite database and license file live under. Changing it orphans that data). The Unestra rebrand was customer-facing display only (`APP_DISPLAY_NAME = 'Unestra'`) — internal identity is untouched.
- **Product/display name**: Unestra.
- **Executable name**: `Unestra`.
- **Certificate type required**: **Developer ID Application** — this is a DMG distributed outside the Mac App Store, so this is the only valid certificate type. Do not use "Apple Development" (local debugging only) or "Apple Distribution" (Mac App Store only).

## Signing configuration (`package.json` → `build.mac`)

```json
"mac": {
  "target": [
    { "target": "dmg", "arch": ["arm64"] },
    { "target": "zip", "arch": ["arm64"] }
  ],
  "icon": "assets/icons/icon.icns",
  "category": "public.app-category.business",
  "hardenedRuntime": true,
  "entitlements": "build/entitlements.mac.plist",
  "entitlementsInherit": "build/entitlements.mac.inherit.plist"
}
```

electron-builder signs the `.app` (and every nested Mach-O binary it contains — frameworks, helper apps, `better-sqlite3`'s native binary) using whichever `Developer ID Application` identity is available in the active keychain at build time. If none is available, it produces an **unsigned** app — silently, unless `CSC_IDENTITY_AUTO_DISCOVERY=false` is explicitly set (which the workflow does for the PR-validation job, to make "this is intentionally unsigned" unambiguous rather than accidental).

## Entitlements (`build/entitlements.mac.plist` and `.inherit.plist`)

| Entitlement | Justification |
|---|---|
| `com.apple.security.cs.allow-jit` | Standard requirement for Electron/Chromium's V8 JIT compiler under Hardened Runtime — every Electron app needs this. |
| `com.apple.security.cs.allow-unsigned-executable-memory` | Standard Electron/V8 requirement under Hardened Runtime; part of Electron's own documented baseline entitlement set. |
| `com.apple.security.cs.allow-dyld-environment-variables` | Part of Electron's documented baseline for apps using `electron-updater`'s Squirrel.Mac-based auto-update mechanism (this app does — see `src/main/updater.js`). |
| `com.apple.security.network.client` | The app makes outgoing HTTPS requests (auto-update check against the GitHub API — see `checkGitHubReleaseManually()` in `src/main/updater.js` — and `electron-updater`'s own feed check). Confirmed via code search: `require("http")`/`require("https")` used in the main process. |
| `com.apple.security.files.user-selected.read-write` | The app uses native save/open dialogs (`dialog.showSaveDialog`/`showOpenDialog` in `src/main/ipc-handlers.js`, `src/main/pdf-generate.js`) for CSV import/export and PDF receipt/report generation. |

**Not included, deliberately:**
- `com.apple.security.cs.disable-library-validation` — not needed. `better-sqlite3`'s native binary (the only true native runtime dependency) gets signed with the same Developer ID identity as the rest of the app during the normal electron-builder signing pass (confirmed via the workflow's nested-binary verification step), so library validation has no reason to reject it.
- `com.apple.security.get-task-allow` — never included; this would allow debugger attachment in a shipped release build, which is exactly what Hardened Runtime is meant to prevent.
- Microphone, camera, screen recording — the desktop Electron shell has no audio/video capture code anywhere (confirmed via a repo-wide search for `getUserMedia`, `navigator.mediaDevices`, `desktopCapturer`, `systemPreferences` — zero matches). Meeting Intelligence's recording capability lives in the web portal (`civicflow-portal`), a separate application; it doesn't apply to this Electron shell.

## Nested code signing

electron-builder signs recursively (main `.app`, Electron Framework, helper apps `Unestra Helper (Renderer).app` / `(GPU).app` / `(Plugin).app`, and any unpacked native binary) using the `entitlementsInherit` file for the helper processes and the main entitlements file for the top-level app. The workflow's `release-candidate` job explicitly enumerates and verifies every Mach-O binary inside the built `.app` (see the "Enumerate and verify nested Mach-O binaries" step) rather than relying on `codesign --deep` alone to hide a signing problem.

`better-sqlite3`'s native `.node` binary is explicitly unpacked from the asar archive via `build.asarUnpack` in `package.json` (added this pass — electron-builder does this automatically for native modules, but making it explicit removes any ambiguity when verifying nested signatures).

## Architecture

**arm64 only.** `better-sqlite3` is rebuilt for whatever architecture the build machine is, via `electron-rebuild` (see the `postinstall` script) — there is no cross-compilation or `lipo`-based universal-binary setup. GitHub's `macos-latest` runners are Apple Silicon (arm64), matching this target exactly. Producing an x64 or universal build would require explicitly cross-compiling `better-sqlite3` for x64 and merging with `lipo` — not attempted this pass, and not currently needed since the existing target already matches the CI runner architecture.

## Verification commands (run by the workflow, real output captured as artifacts)

```bash
codesign --verify --deep --strict --verbose=4 "Unestra.app"
codesign -dv --verbose=4 "Unestra.app"
spctl --assess --type execute --verbose=4 "Unestra.app"
```

See the workflow run linked in `macos-release-checklist.md` for this pass's actual output.
