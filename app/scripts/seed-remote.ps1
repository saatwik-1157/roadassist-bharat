# Load the demo data into a HOSTED database (Neon, Render, ...), once.
#
#   powershell -ExecutionPolicy Bypass -File app\scripts\seed-remote.ps1
#
# The connection string is read with hidden input, held only in this process's
# environment, and removed when the script ends - so it never lands on screen,
# in the shell history, or in a file. Safe to run twice: seed-if-empty.mjs
# skips a database that already has users.

$ErrorActionPreference = "Stop"
$secure = Read-Host "Paste the database connection string (postgresql://...), input is hidden" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:DATABASE_URL = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim()
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
if (-not $env:DATABASE_URL.StartsWith("postgres")) {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Write-Host "That is not a postgres connection string - copy the whole line from Neon > Connect." -ForegroundColor Red
    exit 1
}

Push-Location (Join-Path $PSScriptRoot "..")
try {
    Write-Host "Seeding - this takes a few minutes over the network..."
    node scripts/seed-if-empty.mjs
    if ($LASTEXITCODE -ne 0) { Write-Host "Seed failed (see above)." -ForegroundColor Red; exit $LASTEXITCODE }
    Write-Host "Done. Tell Claude: seeded" -ForegroundColor Green
} finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Pop-Location
}
