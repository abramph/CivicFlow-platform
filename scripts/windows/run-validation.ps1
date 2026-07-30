<#
.SYNOPSIS
  Runs the full local validation battery across portal and mobile: tests,
  typecheck, lint, Prisma schema validation, and a build. Reports a summary
  at the end rather than stopping at the first failure, so you get a full
  picture in one run.
#>
. "$PSScriptRoot\common.ps1"

$results = @()

function Run-Check {
    param([string]$Name, [string]$Dir, [string]$Command)
    Write-Step $Name
    Push-Location (Join-Path $RepoRoot $Dir)
    try {
        Invoke-Expression $Command
        $ok = ($LASTEXITCODE -eq 0)
    } catch {
        $ok = $false
    } finally {
        Pop-Location
    }
    if ($ok) { Write-Ok $Name } else { Write-Fail $Name }
    $Script:results += [PSCustomObject]@{ Check = $Name; Passed = $ok }
}

Run-Check -Name "Portal: typecheck"      -Dir "civicflow-portal" -Command "npx tsc --noEmit"
Run-Check -Name "Portal: lint"           -Dir "civicflow-portal" -Command "npx eslint ."
Run-Check -Name "Portal: unit tests"     -Dir "civicflow-portal" -Command "npx vitest run"

$envDevLocalPath = Join-Path $RepoRoot "civicflow-portal\.env.development.local"
if (Test-Path $envDevLocalPath) {
    $databaseUrl = Get-LocalDevDatabaseUrl
    Assert-LocalDatabaseUrl -DatabaseUrl $databaseUrl
    $env:DATABASE_URL = $databaseUrl
    Run-Check -Name "Portal: Prisma schema validate" -Dir "civicflow-portal" -Command "npx prisma validate"
    Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
} else {
    Write-Warn "Skipping Prisma validate -- run setup-dev.ps1 first to provision a local database."
}

Run-Check -Name "Mobile: typecheck" -Dir "civicflow-mobile" -Command "npx tsc --noEmit"
Run-Check -Name "Mobile: lint"      -Dir "civicflow-mobile" -Command "npx expo lint"
Run-Check -Name "Mobile: jest"      -Dir "civicflow-mobile" -Command "npx jest"
Run-Check -Name "Mobile: expo-doctor" -Dir "civicflow-mobile" -Command "npx expo-doctor"

Run-Check -Name "Dependency audit: portal" -Dir "civicflow-portal" -Command "npm audit --audit-level=critical"
Run-Check -Name "Dependency audit: mobile" -Dir "civicflow-mobile" -Command "npm audit --audit-level=critical"

Write-Step "Summary"
$results | ForEach-Object {
    $status = if ($_.Passed) { "PASS" } else { "FAIL" }
    $color = if ($_.Passed) { "Green" } else { "Red" }
    Write-Host ("  [{0}] {1}" -f $status, $_.Check) -ForegroundColor $color
}
$failCount = ($results | Where-Object { -not $_.Passed }).Count
if ($failCount -gt 0) {
    Write-Host ""
    Write-Fail "$failCount check(s) failed."
    exit 1
} else {
    Write-Host ""
    Write-Ok "All checks passed."
}
