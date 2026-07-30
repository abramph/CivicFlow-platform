<#
.SYNOPSIS
  Launches civicflow-portal, civicflow-mobile, and the Electron desktop app
  each in their own PowerShell window.
#>
. "$PSScriptRoot\common.ps1"

Write-Step "Launching all three dev services in separate windows"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSScriptRoot\start-portal.ps1'"
Write-Ok "civicflow-portal launching in a new window"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSScriptRoot\start-mobile.ps1'"
Write-Ok "civicflow-mobile (Expo) launching in a new window"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSScriptRoot\start-desktop.ps1'"
Write-Ok "Electron desktop launching in a new window"

Write-Host ""
Write-Host "Three new PowerShell windows have opened. Close any of them individually to stop that service."
