<#
.SYNOPSIS
  Starts the civicflow-portal (Next.js) dev server.
#>
. "$PSScriptRoot\common.ps1"

$envDevLocalPath = Join-Path $RepoRoot "civicflow-portal\.env.development.local"
if (Test-Path $envDevLocalPath) {
    Write-Ok "Using civicflow-portal\.env.development.local (local database) -- run setup-dev.ps1 again if you need to recreate it."
} else {
    Write-Warn "civicflow-portal\.env.development.local does not exist -- Next.js will fall back to .env.local, which may point at production."
    Write-Warn "Run scripts\windows\setup-dev.ps1 first to provision a local database."
}

Push-Location (Join-Path $RepoRoot "civicflow-portal")
try {
    & npm run dev
} finally {
    Pop-Location
}
