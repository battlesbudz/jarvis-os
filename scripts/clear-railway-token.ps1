$ErrorActionPreference = "Stop"

[Environment]::SetEnvironmentVariable("RAILWAY_API_TOKEN", $null, "User")
[Environment]::SetEnvironmentVariable("RAILWAY_TOKEN", $null, "User")
Remove-Item Env:RAILWAY_API_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:RAILWAY_TOKEN -ErrorAction SilentlyContinue

Write-Host "Railway user environment token variables removed."
