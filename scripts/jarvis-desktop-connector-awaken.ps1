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

function Show-ProgressStart {
  param(
    [string]$Label,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )

  Write-Host -NoNewline ("  {0} " -f $Label) -ForegroundColor $Color
  foreach ($step in 1..18) {
    Write-Host -NoNewline "."
    Start-Sleep -Milliseconds 45
  }
  Write-Host ""
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

    $probeJob = Start-Job -ScriptBlock {
      param(
        [string]$JobCodexPath,
        [object[]]$JobArguments
      )

      & $JobCodexPath @JobArguments *> $null
      return $LASTEXITCODE
    } -ArgumentList $CodexPath, $arguments

    $completed = Wait-Job -Job $probeJob -Timeout 60
    if ($null -eq $completed) {
      Stop-Job -Job $probeJob -ErrorAction SilentlyContinue
      Remove-Job -Job $probeJob -Force -ErrorAction SilentlyContinue
      return [pscustomobject]@{
        ExitCode = -1
        Output = 'Codex probe timed out.'
      }
    }

    $exitCode = Receive-Job -Job $probeJob -ErrorAction SilentlyContinue | Select-Object -Last 1
    Remove-Job -Job $probeJob -Force -ErrorAction SilentlyContinue

    $lastMessage = ''
    if (Test-Path -LiteralPath $lastMessageFile.FullName) {
      $lastMessage = Get-Content -LiteralPath $lastMessageFile.FullName -Raw -ErrorAction SilentlyContinue
    }

    return [pscustomobject]@{
      ExitCode = $exitCode
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
    return $false
  }

  $codexCommand = Resolve-CodexCommand
  if ([string]::IsNullOrWhiteSpace($codexCommand)) {
    Write-CeremonyLine '  [codex] Codex probe not completed; codex.cmd was not available.' Yellow
    return $false
  }

  $ExpectedMarker = 'JARVIS_AWAKE_OK'
  Write-CeremonyLine ("  [codex] Found launcher: {0}" -f $codexCommand) DarkCyan
  try {
    $probe = Invoke-CodexAwakeProbe -CodexPath $codexCommand -ExpectedMarker $ExpectedMarker
    if ($probe.ExitCode -eq 0 -and $probe.Output -match [regex]::Escape($ExpectedMarker)) {
      Write-CeremonyLine '  [ok] Codex / ChatGPT sign-in verified.' Green
      Write-CeremonyLine '  [ok] Test response received from Codex.' Green
      return $true
    }
  } catch {
    Write-CeremonyLine ("  [codex] Codex probe not completed; {0}" -f $_.Exception.Message) Yellow
    return $false
  }

  Write-CeremonyLine '  [codex] Codex probe not completed; expected marker was not returned.' Yellow
  return $false
}

Show-Banner
Write-CeremonyLine '  Initializing local desktop connector channel...' White
Start-CeremonyPause

Show-ProgressStage 'Local shell'
Write-CeremonyLine '  [ok] Local shell verified' Green
$localShellVerified = $true
Start-CeremonyPause

Show-ProgressStage 'Jarvis server'
Test-Server -TargetServer $Server
if (-not [string]::IsNullOrWhiteSpace($SetupId)) {
  Write-CeremonyLine ("  [setup] Setup id received: {0}" -f $SetupId) DarkCyan
}
Start-CeremonyPause

Show-ProgressStart 'Codex channel'
$codexVerified = Test-Codex -SkipProbe:$SkipCodexProbe
Start-CeremonyPause

Write-Host ''
Write-CeremonyLine '  ------------------------------------------------' DarkCyan
if ($localShellVerified -and $codexVerified) {
  Write-CeremonyLine '  JARVIS: Hello, world. I am awake.' Green
} else {
  Write-CeremonyLine '  JARVIS: Local shell is awake. Codex needs attention.' Yellow
}
Write-CeremonyLine '  ------------------------------------------------' DarkCyan
Write-Host ''
Write-CeremonyLine 'Press any key to close this window.' White
if (-not [Console]::IsInputRedirected) {
  [void][Console]::ReadKey($true)
}
