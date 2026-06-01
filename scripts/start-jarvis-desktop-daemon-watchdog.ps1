param(
  [string]$Server = "https://gameplanjarvisai.up.railway.app",
  [string]$Root = (Join-Path $env:USERPROFILE "jarvis-workspace"),
  [string]$RepoRoot,
  [string]$StatePath = (Join-Path $env:APPDATA "Jarvis\desktop-daemon-state.json"),
  [string]$PairCode = "",
  [string]$TaskName = "Jarvis Desktop Daemon",
  [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (!$RepoRoot) {
  $RepoRoot = Split-Path -Parent $ScriptDir
}

$DaemonPath = Join-Path $RepoRoot "daemon\jarvis-daemon.js"
$LogDir = Join-Path $env:LOCALAPPDATA "Jarvis\logs"
$LogPath = Join-Path $LogDir "jarvis-desktop-daemon-watchdog.log"
$NodeExe = "node.exe"

function Write-WatchdogLog {
  param([string]$Message)
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  $timestamp = (Get-Date).ToString("o")
  Add-Content -LiteralPath $LogPath -Encoding UTF8 -Value "[$timestamp] [$TaskName] $Message"
}

if (!(Test-Path $DaemonPath)) {
  throw "Desktop daemon script not found: $DaemonPath"
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StatePath) | Out-Null

Write-WatchdogLog "watchdog started; repo=$RepoRoot root=$Root state=$StatePath"

while ($true) {
  try {
    $env:JARVIS_SERVER = $Server
    $env:JARVIS_DAEMON_ROOT = $Root
    $env:JARVIS_DAEMON_PLATFORM = "desktop"
    $env:JARVIS_DAEMON_STATE_PATH = $StatePath
    if ($PairCode) {
      $env:JARVIS_PAIR_CODE = $PairCode
    } else {
      Remove-Item Env:JARVIS_PAIR_CODE -ErrorAction SilentlyContinue
    }

    Write-WatchdogLog "starting daemon"
    & $NodeExe $DaemonPath *>> $LogPath
    $exitCode = $LASTEXITCODE
    Write-WatchdogLog "daemon exited with code $exitCode"
  } catch {
    Write-WatchdogLog "daemon launch failed: $($_.Exception.Message)"
  }

  if ($PairCode -and (Test-Path $StatePath)) {
    $PairCode = ""
    Remove-Item Env:JARVIS_PAIR_CODE -ErrorAction SilentlyContinue
    Write-WatchdogLog "pair code cleared after reconnect state was saved"
  }

  Start-Sleep -Seconds ([Math]::Max(1, $RestartDelaySeconds))
}
