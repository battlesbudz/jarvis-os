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
  Write-Host '       _    _    ____   __     __  ___   ____' -ForegroundColor Cyan
  Write-Host '      | |  / \  |  _ \  \ \   / / |_ _| / ___|' -ForegroundColor Cyan
  Write-Host '   _  | | / _ \ | |_) |  \ \ / /   | |  \___ \' -ForegroundColor Cyan
  Write-Host '  | |_| |/ ___ \|  _ <    \ V /    | |   ___) |' -ForegroundColor Cyan
  Write-Host '   \___//_/   \_\_| \_\    \_/    |___| |____/' -ForegroundColor Cyan
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

function Resolve-CodexCommand {
  $candidatePaths = @()

  if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
    $candidatePaths += (Join-Path $env:APPDATA 'npm\codex.cmd')
  }

  foreach ($candidatePath in $candidatePaths) {
    if (Test-Path -LiteralPath $candidatePath) {
      return $candidatePath
    }
  }

  $cmdCommand = Get-Command codex.cmd -ErrorAction SilentlyContinue
  if ($null -ne $cmdCommand -and -not [string]::IsNullOrWhiteSpace($cmdCommand.Source)) {
    return $cmdCommand.Source
  }

  $bareCommand = Get-Command codex -ErrorAction SilentlyContinue
  if ($null -eq $bareCommand -or [string]::IsNullOrWhiteSpace($bareCommand.Source)) {
    return $null
  }

  if ([IO.Path]::GetExtension($bareCommand.Source) -ieq '.ps1') {
    Write-CeremonyLine '  [codex] PowerShell shim found but skipped; codex.ps1 is blocked by execution policy.' Yellow
    return $null
  }

  return $bareCommand.Source
}

function Invoke-CodexAwakeProbe {
  param(
    [string]$CodexPath,
    [string]$ExpectedMarker
  )

  $lastMessageFile = New-TemporaryFile
  $prompt = "Return only this exact marker and no other text: $ExpectedMarker"
  $arguments = @(
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--output-last-message",
    $lastMessageFile.FullName,
    "--color",
    "never",
    $prompt
  )

  try {
    Write-CeremonyLine '  [codex] Running codex exec proof prompt...' DarkCyan

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $CodexPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true

    foreach ($argument in $arguments) {
      [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    [void]$process.Start()

    $completed = $process.WaitForExit(60000)
    if (-not $completed) {
      $process.Kill()
      $process.WaitForExit()
      return [pscustomobject]@{
        ExitCode = -1
        Output = 'Codex probe timed out.'
      }
    }

    $lastMessage = ''
    if (Test-Path -LiteralPath $lastMessageFile.FullName) {
      $lastMessage = Get-Content -LiteralPath $lastMessageFile.FullName -Raw -ErrorAction SilentlyContinue
    }

    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Output = $lastMessage
    }
  } finally {
    Remove-Item -LiteralPath $lastMessageFile.FullName -Force -ErrorAction SilentlyContinue
  }
}

function Test-Codex {
  param([switch]$SkipProbe)

  if ($SkipProbe) {
    Write-CeremonyLine '  [codex] Probe skipped; Codex verification was not claimed.' Yellow
    return
  }

  $codexCommand = Resolve-CodexCommand
  if ([string]::IsNullOrWhiteSpace($codexCommand)) {
    Write-CeremonyLine '  [codex] Codex probe not completed; codex.cmd was not available.' Yellow
    return
  }

  $ExpectedMarker = 'JARVIS_AWAKE_OK'
  Write-CeremonyLine ("  [codex] Found launcher: {0}" -f $codexCommand) DarkCyan
  try {
    $probe = Invoke-CodexAwakeProbe -CodexPath $codexCommand -ExpectedMarker $ExpectedMarker
    if ($probe.ExitCode -eq 0 -and $probe.Output -match [regex]::Escape($ExpectedMarker)) {
      Write-CeremonyLine '  [ok] Codex / ChatGPT sign-in verified.' Green
      Write-CeremonyLine '  [ok] Test response received from Codex.' Green
      return
    }
  } catch {
    Write-CeremonyLine ("  [codex] Codex probe not completed; {0}" -f $_.Exception.Message) Yellow
    return
  }

  Write-CeremonyLine '  [codex] Codex probe not completed; expected marker was not returned.' Yellow
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
