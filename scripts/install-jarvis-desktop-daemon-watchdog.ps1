param(
  [string]$TaskName = "Jarvis Desktop Daemon",
  [string]$Server = "https://gameplanjarvisai.up.railway.app",
  [string]$Root = (Join-Path $env:USERPROFILE "jarvis-workspace"),
  [string]$RepoRoot,
  [string]$StatePath = (Join-Path $env:APPDATA "Jarvis\desktop-daemon-state.json"),
  [string]$PairCode = "",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (!$RepoRoot) {
  $RepoRoot = Split-Path -Parent $ScriptDir
}

$WatchdogPath = Join-Path $ScriptDir "start-jarvis-desktop-daemon-watchdog.ps1"
if (!(Test-Path $WatchdogPath)) {
  throw "Desktop daemon watchdog not found: $WatchdogPath"
}

function Stop-ExistingDesktopDaemonRuntime {
  try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  } catch {
    Write-Host "Could not stop existing scheduled task: $($_.Exception.Message)"
  }

  $patterns = @(
    "start-jarvis-desktop-daemon-watchdog.ps1",
    "jarvis-daemon.js"
  )

  $processes = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe' OR Name = 'node.exe'" |
    Where-Object {
      $commandLine = $_.CommandLine
      $commandLine -and ($patterns | Where-Object { $commandLine -like "*$_*" })
    }

  foreach ($process in $processes) {
    if ($process.ProcessId -eq $PID) {
      continue
    }
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
      Write-Host "Stopped existing desktop daemon process $($process.ProcessId)."
    } catch {
      Write-Host "Could not stop desktop daemon process $($process.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Quote-PowerShellArg {
  param([string]$Value)
  return "`"$($Value -replace '"', '\"')`""
}

Stop-ExistingDesktopDaemonRuntime

$RunnerArgs = @(
  "-NoProfile",
  "-ExecutionPolicy Bypass",
  "-File $(Quote-PowerShellArg $WatchdogPath)",
  "-Server $(Quote-PowerShellArg $Server)",
  "-Root $(Quote-PowerShellArg $Root)",
  "-RepoRoot $(Quote-PowerShellArg $RepoRoot)",
  "-StatePath $(Quote-PowerShellArg $StatePath)"
) -join " "

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument $RunnerArgs `
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
    -Description "Keeps the Jarvis Desktop Daemon connected so hosted Jarvis can use local desktop capabilities and Codex OAuth." `
    -Force | Out-Null

  Write-Host "Installed scheduled task: $TaskName"
} catch {
  $StartupDir = [Environment]::GetFolderPath("Startup")
  $LauncherPath = Join-Path $StartupDir "Jarvis Desktop Daemon.cmd"
  $Launcher = @(
    "@echo off",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$WatchdogPath`" -Server `"$Server`" -Root `"$Root`" -RepoRoot `"$RepoRoot`" -StatePath `"$StatePath`""
  ) -join "`r`n"
  Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding ASCII
  Write-Host "Scheduled Task registration failed: $($_.Exception.Message)"
  Write-Host "Registered Startup folder launcher instead: $LauncherPath"
}

Write-Host "Runner: powershell.exe $RunnerArgs"
Write-Host "Working directory: $RepoRoot"
Write-Host "State path: $StatePath"

if (!$NoStart) {
  if ($PairCode) {
    $DirectArgs = "$RunnerArgs -PairCode $(Quote-PowerShellArg $PairCode)"
    Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList $DirectArgs -WorkingDirectory "$RepoRoot"
    Write-Host "Started desktop daemon watchdog directly with a one-time pair code."
  } else {
    try {
      Start-ScheduledTask -TaskName $TaskName
      Write-Host "Started scheduled task: $TaskName"
    } catch {
      Start-Process -WindowStyle Hidden -FilePath "powershell.exe" -ArgumentList $RunnerArgs -WorkingDirectory "$RepoRoot"
      Write-Host "Started desktop daemon watchdog directly."
    }
  }
}
