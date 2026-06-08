param(
  [string]$Server = "https://gameplanjarvisai.up.railway.app",
  [string]$Root = (Join-Path $env:USERPROFILE "jarvis-workspace"),
  [string]$RepoRoot,
  [string]$StatePath = (Join-Path $env:APPDATA "Jarvis\desktop-daemon-state.json"),
  [string]$CodexCommand = "",
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

function Resolve-CodexCommand {
  if ($CodexCommand) {
    return $CodexCommand
  }

  if ($env:JARVIS_CODEX_COMMAND) {
    return $env:JARVIS_CODEX_COMMAND
  }

  $command = Get-Command codex.cmd -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  $command = Get-Command codex.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  $command = Get-Command codex -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  $windowsAppsRoot = Join-Path $env:ProgramFiles "WindowsApps"
  if (Test-Path -LiteralPath $windowsAppsRoot) {
    $windowsAppsCodex = Get-ChildItem -LiteralPath $windowsAppsRoot -Directory -Filter "OpenAI.Codex_*" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      ForEach-Object { Join-Path $_.FullName "app\resources\codex.exe" } |
      Where-Object { Test-Path -LiteralPath $_ } |
      Select-Object -First 1
    if ($windowsAppsCodex) {
      return $windowsAppsCodex
    }
  }

  return ""
}

function Quote-CmdArg {
  param([string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
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
    $env:JARVIS_CODEX_APP_SERVER_ENABLED = "false"
    $env:JARVIS_CODEX_APP_SERVER_PREWARM = "false"
    $codexCommand = Resolve-CodexCommand
    if ($codexCommand) {
      $env:JARVIS_CODEX_COMMAND = $codexCommand
      Write-WatchdogLog "using Codex command: $codexCommand"
    } else {
      Remove-Item Env:JARVIS_CODEX_COMMAND -ErrorAction SilentlyContinue
      Write-WatchdogLog "Codex command was not found on PATH"
    }
    if ($PairCode) {
      $env:JARVIS_PAIR_CODE = $PairCode
    } else {
      Remove-Item Env:JARVIS_PAIR_CODE -ErrorAction SilentlyContinue
    }

    Write-WatchdogLog "starting daemon"
    $nodeCommand = "$(Quote-CmdArg $NodeExe) $(Quote-CmdArg $DaemonPath) >> $(Quote-CmdArg $LogPath) 2>&1"
    & cmd.exe /d /s /c $nodeCommand
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
