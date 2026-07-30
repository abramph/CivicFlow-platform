# Shared helpers for the Windows dev scripts. Dot-source this file:
#   . "$PSScriptRoot\common.ps1"

$ErrorActionPreference = "Stop"

# Repo root is one level up from this scripts\windows directory.
$Script:RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  [ok] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  [warn] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "  [fail] $Message" -ForegroundColor Red
}

function Assert-Command {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$InstallHint = ""
    )
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Fail "'$Name' was not found on PATH.$(if ($InstallHint) { " $InstallHint" })"
        exit 1
    }
    return $cmd
}

# Never let a local script resolve to a real production database host.
# civicflow-portal's real dev-DB gap: .env.local has historically pointed at
# the live DigitalOcean managed Postgres cluster (civicflowprod-do-...). Any
# script here that touches a database must refuse to run against anything
# that isn't localhost/127.0.0.1.
function Assert-LocalDatabaseUrl {
    param([Parameter(Mandatory)][string]$DatabaseUrl)

    if ($DatabaseUrl -notmatch '^\s*postgresql://') {
        Write-Fail "DATABASE_URL does not look like a postgresql:// connection string."
        exit 1
    }

    try {
        $uri = [System.Uri]($DatabaseUrl -replace '^postgresql://', 'http://')
        $hostName = $uri.Host
    } catch {
        Write-Fail "Could not parse DATABASE_URL to check its host."
        exit 1
    }

    if ($hostName -notin @('localhost', '127.0.0.1', '::1')) {
        Write-Fail "DATABASE_URL host is '$hostName', not localhost."
        Write-Fail "Refusing to run a destructive local-dev command against a non-local database."
        Write-Fail "This almost always means DATABASE_URL is still pointing at production."
        exit 1
    }
}

# Reads civicflow-portal/.env.development.local (the local-only override this
# script suite creates) and returns the DATABASE_URL it contains, without ever
# touching or printing .env.local (which may hold real production credentials).
function Get-LocalDevDatabaseUrl {
    $envPath = Join-Path $Script:RepoRoot "civicflow-portal\.env.development.local"
    if (-not (Test-Path $envPath)) {
        Write-Fail "civicflow-portal\.env.development.local does not exist yet. Run setup-dev.ps1 first."
        exit 1
    }
    $line = Get-Content $envPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
    if (-not $line) {
        Write-Fail "No DATABASE_URL found in civicflow-portal\.env.development.local."
        exit 1
    }
    $value = ($line -split '=', 2)[1].Trim().Trim('"')
    return $value
}
