[CmdletBinding()]
param(
  [string]$DbPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "licenses.db"),
  [Parameter(Mandatory = $true)]
  [string]$LicenseKey,
  [int]$Limit = 25
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$resolvedDbPath = (Resolve-Path -LiteralPath $DbPath).Path
$clampedLimit = [Math]::Min([Math]::Max($Limit, 1), 200)

$nodeScript = @"
const sqlite3 = require("sqlite3").verbose();

const dbPath = process.argv[1];
const licenseKey = process.argv[2];
const limit = Math.max(1, Math.min(Number(process.argv[3] || "25"), 200));

function allAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function getAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

(async () => {
  const db = new sqlite3.Database(dbPath);
  try {
    const license = await getAsync(db, "SELECT * FROM licenses WHERE license_key = ?", [licenseKey]);
    if (!license) {
      throw new Error(`License not found: ${licenseKey}`);
    }

    const activations = await allAsync(db, `
      SELECT *
      FROM activations
      WHERE license_id = ?
      ORDER BY id DESC
      LIMIT ?
    `, [license.id, limit]);

    const purchaseEvents = await allAsync(db, `
      SELECT *
      FROM purchase_events
      WHERE license_id = ? OR target_license_id = ?
      ORDER BY id DESC
      LIMIT ?
    `, [license.id, license.id, limit]);

    const licenseEvents = await allAsync(db, `
      SELECT *
      FROM license_events
      WHERE license_id = ?
      ORDER BY id DESC
      LIMIT ?
    `, [license.id, limit]);

    console.log(JSON.stringify({
      dbPath,
      license,
      activations,
      purchaseEvents,
      licenseEvents,
    }, null, 2));
  } finally {
    db.close();
  }
})().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
"@

Push-Location $root
try {
  & node -e $nodeScript $resolvedDbPath $LicenseKey $clampedLimit
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
