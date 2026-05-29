param(
  [string]$TaskName = "Jarvis Codex OAuth Gateway",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$WatchdogPath = Join-Path $ScriptDir "watch-jarvis-oauth-gateway.ps1"

if (!(Test-Path $WatchdogPath)) {
  throw "Gateway watchdog not found: $WatchdogPath"
}

function Stop-ExistingGatewayRuntime {
  try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  } catch {
    Write-Host "Could not stop existing scheduled task: $($_.Exception.Message)"
  }

  $Patterns = @(
    "watch-jarvis-oauth-gateway.ps1",
    "start-jarvis-oauth-gateway-supervisor.ps1",
    "jarvis-oauth-gateway-supervisor.mjs",
    "jarvis-local-oauth-gateway.mjs",
    "jarvis-codex-gateway-server.mjs"
  )

  $Processes = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe' OR Name = 'node.exe'" |
    Where-Object {
      $CommandLine = $_.CommandLine
      $CommandLine -and ($Patterns | Where-Object { $CommandLine -like "*$_*" })
    }

  foreach ($Process in $Processes) {
    if ($Process.ProcessId -eq $PID) {
      continue
    }
    try {
      Stop-Process -Id $Process.ProcessId -Force -ErrorAction Stop
      Write-Host "Stopped existing gateway process $($Process.ProcessId)."
    } catch {
      Write-Host "Could not stop gateway process $($Process.ProcessId): $($_.Exception.Message)"
    }
  }
}

Stop-ExistingGatewayRuntime

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogPath`"" `
  -WorkingDirectory "$RepoRoot"

$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Days 30) `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$Principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Keeps the Jarvis local ChatGPT/Codex OAuth gateway watchdog running for hosted Jarvis." `
    -Force | Out-Null

  Write-Host "Installed scheduled task: $TaskName"
} catch {
  $StartupDir = [Environment]::GetFolderPath("Startup")
  $LauncherPath = Join-Path $StartupDir "Jarvis Codex OAuth Gateway.cmd"
  $Launcher = @(
    "@echo off",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$WatchdogPath`""
  ) -join "`r`n"
  Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding ASCII
  Write-Host "Scheduled Task registration failed: $($_.Exception.Message)"
  Write-Host "Registered Startup folder launcher instead: $LauncherPath"
}

Write-Host "Runner: powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$WatchdogPath`""
Write-Host "Working directory: $RepoRoot"

if (!$NoStart) {
  try {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started scheduled task: $TaskName"
  } catch {
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogPath`"" -WorkingDirectory "$RepoRoot" -WindowStyle Hidden
    Write-Host "Started gateway watchdog directly."
  }
}
