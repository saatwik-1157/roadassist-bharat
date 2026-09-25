# Upload the project's real YOLO11 detections (ai/cv-detections-full.json) to a
# hosted RAKSHA, through a device an officer registered on the dashboard.
#
#   powershell -ExecutionPolicy Bypass -File app\scripts\raksha-upload.ps1
#
# Register the device first: RAKSHA -> sign in with email -> "Register an edge
# device" -> copy the deviceId and deviceSecret it shows once. The secret is
# read here with hidden input and lives only in this process's environment, so
# it never lands on screen, in shell history, or in a file. Safe to run twice:
# every detection carries its own id, and a replay is counted as a duplicate.

param([string]$Api = "https://app.roadassistbharat.online")

$ErrorActionPreference = "Stop"
$env:RAKSHA_DEVICE_ID = (Read-Host "deviceId (from RAKSHA)").Trim()
$secure = Read-Host "deviceSecret (input is hidden)" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:RAKSHA_DEVICE_SECRET = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim()
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

Push-Location (Join-Path $PSScriptRoot "..")
try {
    $env:API = $Api
    node scripts/raksha-simulator.mjs --from-json ../ai/cv-detections-full.json
    if ($LASTEXITCODE -ne 0) { Write-Host "Upload failed (see above)." -ForegroundColor Red; exit $LASTEXITCODE }
    Write-Host "Done. In RAKSHA, click Recompute to score the corridor, then tell Claude: uploaded" -ForegroundColor Green
} finally {
    Remove-Item Env:RAKSHA_DEVICE_SECRET, Env:RAKSHA_DEVICE_ID, Env:API -ErrorAction SilentlyContinue
    Pop-Location
}
