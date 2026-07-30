<#
.SYNOPSIS
  Drops and recreates the local civicflow_dev database, re-runs migrations,
  and reseeds fictional demo data (Pine Grove PTA, Riverdale, etc.).

.DESCRIPTION
  SAFETY: this script only ever reads DATABASE_URL from
  civicflow-portal\.env.development.local (the local-only file setup-dev.ps1
  creates) and refuses to run at all if that URL's host isn't localhost/
  127.0.0.1. It never reads or touches .env.local, which may point at
  production. Run setup-dev.ps1 first if .env.development.local doesn't exist.
#>
param(
    [switch]$SkipSeed
)

. "$PSScriptRoot\common.ps1"

$databaseUrl = Get-LocalDevDatabaseUrl
Assert-LocalDatabaseUrl -DatabaseUrl $databaseUrl

Write-Step "Resetting local dev database"
Write-Warn "This will drop and recreate the local civicflow_dev database. All local data will be lost."
$confirmation = Read-Host "Type 'reset' to continue"
if ($confirmation -ne "reset") {
    Write-Host "Aborted."
    exit 0
}

Push-Location (Join-Path $RepoRoot "civicflow-portal")
try {
    $env:DATABASE_URL = $databaseUrl
    & npx prisma migrate reset --force --skip-seed
    if ($LASTEXITCODE -ne 0) { Write-Fail "prisma migrate reset failed"; exit 1 }
    Write-Ok "Database dropped, recreated, and migrated."

    if (-not $SkipSeed) {
        & npm run db:seed
        & npm run db:seed:pta-demo
        Write-Ok "Fictional demo data reseeded."
    } else {
        Write-Warn "Skipped seeding (-SkipSeed)."
    }
} finally {
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}

Write-Step "Done"
