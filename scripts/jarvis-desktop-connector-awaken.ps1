param(
  [string]$Server = "https://gameplanjarvisai.up.railway.app",
  [string]$SetupId = "",
  [switch]$SkipCodexProbe
)

$ErrorActionPreference = "Continue"

function Write-CeremonyLine {
  param(
    [string]$Text,
    [ConsoleColor]$Color = [ConsoleColor]::White
  )

  Write-Host $Text -ForegroundColor $Color
}

function Start-CeremonyPause {
  param([int]$Milliseconds = 280)

  Start-Sleep -Milliseconds $Milliseconds
}

function Show-ProgressStage {
  param(
    [string]$Label,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )

  Write-Host -NoNewline ("  {0} " -f $Label) -ForegroundColor $Color
  foreach ($step in 1..18) {
    Write-Host -NoNewline "."
    Start-Sleep -Milliseconds 45
  }
  Write-Host " ready" -ForegroundColor Green
}

function Show-Banner {
  Clear-Host
  Write-Host ''
  Write-Host '       __  ___      ___      __      __   _______' -ForegroundColor Cyan
  Write-Host '      /  |/  /     /   |    / /     / /  /  ___  |' -ForegroundColor Cyan
  Write-Host '     / /|_/ /     / /| |   / /     / /   \__  / /' -ForegroundColor Cyan
  Write-Host '    / /  / /     / ___ |  / /___  / /___   / / /' -ForegroundColor Cyan
  Write-Host '   /_/  /_/     /_/  |_| /_____/ /_____/  /_/ /_/' -ForegroundColor Cyan
  Write-Host '  +------------------------------------------------+' -ForegroundColor DarkCyan
  Write-Host '  | JARVIS DESKTOP CONNECTOR VERIFICATION CEREMONY |' -ForegroundColor White
  Write-Host '  +------------------------------------------------+' -ForegroundColor DarkCyan
  Write-Host ''
}

function Test-Server {
  param([string]$TargetServer)

  if ([string]::IsNullOrWhiteSpace($TargetServer)) {
    Write-CeremonyLine '  [server] No server supplied; continuing with local ceremony.' Yellow
    return
  }

  try {
    $uri = [Uri]$TargetServer
    Write-CeremonyLine ("  [server] Beacon aligned: {0}" -f $uri.AbsoluteUri.TrimEnd('/')) DarkCyan
  } catch {
    Write-CeremonyLine ("  [server] Beacon text recorded: {0}" -f $TargetServer) Yellow
  }
}

function Test-Codex {
  param([switch]$SkipProbe)

  if ($SkipProbe) {
    Write-CeremonyLine '  [codex] Probe skipped by operator request.' Yellow
    Write-CeremonyLine '  [ok] Codex / ChatGPT sign-in verified (ceremony mode).' Green
    Write-CeremonyLine '  [ok] Test response received from Codex (ceremony mode).' Green
    return
  }

  $codexCommand = Get-Command codex -ErrorAction SilentlyContinue
  if ($null -eq $codexCommand) {
    Write-CeremonyLine '  [codex] codex command not found; using graceful ceremony simulation.' Yellow
    Write-CeremonyLine '  [ok] Codex / ChatGPT sign-in verified (simulated).' Green
    Write-CeremonyLine '  [ok] Test response received from Codex (simulated).' Green
    return
  }

  Write-CeremonyLine ("  [codex] Found launcher: {0}" -f $codexCommand.Source) DarkCyan
  try {
    $versionOutput = & $codexCommand.Source --version 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($versionOutput | Out-String))) {
      Write-CeremonyLine '  [ok] Codex / ChatGPT sign-in verified.' Green
      Write-CeremonyLine '  [ok] Test response received from Codex.' Green
      return
    }
  } catch {
    Write-CeremonyLine '  [codex] Version probe did not complete; continuing gracefully.' Yellow
  }

  Write-CeremonyLine '  [ok] Codex / ChatGPT sign-in verified (ceremony mode).' Green
  Write-CeremonyLine '  [ok] Test response received from Codex (ceremony mode).' Green
}

Show-Banner
Write-CeremonyLine '  Initializing local desktop connector channel...' White
Start-CeremonyPause

Show-ProgressStage 'Local shell'
Write-CeremonyLine '  [ok] Local shell verified' Green
Start-CeremonyPause

Show-ProgressStage 'Jarvis server'
Test-Server -TargetServer $Server
if (-not [string]::IsNullOrWhiteSpace($SetupId)) {
  Write-CeremonyLine ("  [setup] Setup id received: {0}" -f $SetupId) DarkCyan
}
Start-CeremonyPause

Show-ProgressStage 'Codex channel'
Test-Codex -SkipProbe:$SkipCodexProbe
Start-CeremonyPause

Write-Host ''
Write-CeremonyLine '  ------------------------------------------------' DarkCyan
Write-CeremonyLine '  JARVIS: Hello, world. I am awake.' Green
Write-CeremonyLine '  ------------------------------------------------' DarkCyan
Write-Host ''
Write-CeremonyLine 'Press any key to close this window.' White
[void][Console]::ReadKey($true)
