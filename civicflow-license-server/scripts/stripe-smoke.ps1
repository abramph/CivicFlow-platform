[CmdletBinding()]
param(
  [string]$ServerUrl = "http://127.0.0.1:4000",
  [Parameter(Mandatory = $true)]
  [string]$PriceId,
  [ValidateSet("new_purchase", "annual_renewal", "maintenance_renewal")]
  [string]$PurchaseKind = "new_purchase",
  [Parameter(Mandatory = $true)]
  [string]$CustomerEmail,
  [Parameter(Mandatory = $true)]
  [string]$OrganizationName,
  [string]$TargetLicenseKey,
  [ValidateSet("test", "prod")]
  [string]$Environment = "test",
  [string]$SuccessUrl = "http://127.0.0.1:3000/buy?status=success",
  [string]$CancelUrl = "http://127.0.0.1:3000/buy?status=cancelled"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($PurchaseKind -ne "new_purchase" -and [string]::IsNullOrWhiteSpace($TargetLicenseKey)) {
  throw "TargetLicenseKey is required for $PurchaseKind."
}

$server = $ServerUrl.TrimEnd("/")
$payload = @{
  priceId = $PriceId
  purchaseKind = $PurchaseKind
  customerEmail = $CustomerEmail
  organizationName = $OrganizationName
  targetLicenseKey = if ([string]::IsNullOrWhiteSpace($TargetLicenseKey)) { $null } else { $TargetLicenseKey.Trim() }
  environment = $Environment
  successUrl = $SuccessUrl
  cancelUrl = $CancelUrl
}

try {
  $response = Invoke-RestMethod `
    -Method Post `
    -Uri "$server/api/store/checkout" `
    -ContentType "application/json" `
    -Body ($payload | ConvertTo-Json -Depth 6)
} catch {
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $reader.BaseStream.Position = 0
    $reader.DiscardBufferedData()
    $body = $reader.ReadToEnd()
    throw "Checkout request failed: $body"
  }
  throw
}

if (-not $response.checkoutUrl) {
  throw "License server did not return checkoutUrl."
}

Write-Host ""
Write-Host "Checkout URL:"
Write-Host $response.checkoutUrl
Write-Host ""
Write-Host "Response:"
$response | ConvertTo-Json -Depth 6
