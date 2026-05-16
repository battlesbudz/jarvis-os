param(
  [string]$Token,
  [switch]$ProjectToken
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  $secureToken = Read-Host "Paste Railway API token" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try {
    $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    if ($ptr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }
}

if (-not $Token -or $Token.Trim().Length -lt 20) {
  throw "No valid Railway token was provided."
}

$trimmedToken = $Token.Trim()

if ($ProjectToken) {
  [Environment]::SetEnvironmentVariable("RAILWAY_TOKEN", $trimmedToken, "User")
  [Environment]::SetEnvironmentVariable("RAILWAY_API_TOKEN", $null, "User")
  $env:RAILWAY_TOKEN = $trimmedToken
  Remove-Item Env:RAILWAY_API_TOKEN -ErrorAction SilentlyContinue

  Write-Host "Railway project token stored as RAILWAY_TOKEN."
  Write-Host "Verifying Railway project access..."
  railway.cmd status --json
  exit $LASTEXITCODE
}

[Environment]::SetEnvironmentVariable("RAILWAY_API_TOKEN", $trimmedToken, "User")
[Environment]::SetEnvironmentVariable("RAILWAY_TOKEN", $null, "User")
$env:RAILWAY_API_TOKEN = $trimmedToken
Remove-Item Env:RAILWAY_TOKEN -ErrorAction SilentlyContinue

Write-Host "Railway account/workspace token stored as RAILWAY_API_TOKEN."
Write-Host "Cleared RAILWAY_TOKEN to avoid CLI precedence conflicts."
Write-Host "Verifying Railway account/workspace access..."

railway.cmd whoami --json
