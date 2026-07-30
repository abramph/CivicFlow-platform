<#
.SYNOPSIS
  Starts the Electron desktop app in dev mode (renderer + main process).

.DESCRIPTION
  Runs the root package's "dev" script (vite renderer + electron, via
  concurrently). Desktop dev mode uses its own local SQLite storage and has an
  offline-license dev path (see README.md's CIVICFLOW_ALLOW_SIGNED_LICENSES) --
  it does not require civicflow-license-server or cloud-api running for basic
  UI development. Start those separately (npm run dev:cloud from repo root,
  or cd civicflow-license-server && npm run dev) only if you're specifically
  testing license activation or payment-webhook flows.
#>
. "$PSScriptRoot\common.ps1"

Push-Location $RepoRoot
try {
    & npm run dev
} finally {
    Pop-Location
}
