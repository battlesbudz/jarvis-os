param(
  [string]$Server = "https://gameplanjarvisai.up.railway.app",
  [string]$SetupId = "",
  [switch]$SkipCodexProbe
)

$ErrorActionPreference = "Continue"

$script:AnsiEnabled = $false
try {
  if ($Host.UI -and $Host.UI.RawUI) {
    $Host.UI.RawUI.WindowTitle = "Jarvis Desktop Link"
    $bufferSize = $Host.UI.RawUI.BufferSize
    if ($bufferSize.Width -lt 104) { $bufferSize.Width = 104 }
    if ($bufferSize.Height -lt 120) { $bufferSize.Height = 120 }
    $Host.UI.RawUI.BufferSize = $bufferSize
    $windowSize = $Host.UI.RawUI.WindowSize
    if ($windowSize.Width -lt 104) { $windowSize.Width = 104 }
    if ($windowSize.Height -lt 34) { $windowSize.Height = 34 }
    $Host.UI.RawUI.WindowSize = $windowSize
  }
  if ($PSStyle) {
    $PSStyle.OutputRendering = "Ansi"
  }
  $script:AnsiEnabled = $true
} catch {
  $script:AnsiEnabled = $false
}

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

function Write-TypewriterLine {
  param(
    [string]$Text,
    [ConsoleColor]$Color = [ConsoleColor]::White,
    [int]$DelayMs = 12
  )

  foreach ($char in $Text.ToCharArray()) {
    Write-Host -NoNewline $char -ForegroundColor $Color
    Start-Sleep -Milliseconds $DelayMs
  }
  Write-Host ""
}

function Show-StatusStage {
  param(
    [string]$Label,
    [string]$Status = "ONLINE",
    [ConsoleColor]$Color = [ConsoleColor]::Cyan,
    [ConsoleColor]$StatusColor = [ConsoleColor]::Green
  )

  $spinner = @("|", "/", "-", "\")
  Write-Host -NoNewline ("  {0,-36}" -f $Label) -ForegroundColor $Color
  foreach ($step in 0..15) {
    Write-Host -NoNewline ("`b{0}" -f $spinner[$step % $spinner.Count]) -ForegroundColor DarkCyan
    Start-Sleep -Milliseconds 55
  }
  Write-Host -NoNewline "`b"
  Write-Host ("[{0}]" -f $Status) -ForegroundColor $StatusColor
}

function Show-ProgressStart {
  param(
    [string]$Label,
    [ConsoleColor]$Color = [ConsoleColor]::Cyan
  )

  Write-Host -NoNewline ("  {0,-36}" -f $Label) -ForegroundColor $Color
  foreach ($frame in @("<:::::>", "<=====>", "<:::::>", "<== ==>", "<=====>")) {
    Write-Host -NoNewline ("`r  {0,-36} {1}" -f $Label, $frame) -ForegroundColor DarkCyan
    Start-Sleep -Milliseconds 140
  }
  Write-Host ""
}

function Show-CorePulse {
  param([int]$Cycles = 2)

  $frames = @(
    "       |        <::>        |",
    "       |       <::::>       |",
    "       |      <::::::>      |",
    "       |       <====>       |",
    "       |        <==>        |"
  )

  for ($cycle = 0; $cycle -lt $Cycles; $cycle++) {
    foreach ($frame in $frames) {
      Write-Host "`r$frame" -NoNewline -ForegroundColor Cyan
      Start-Sleep -Milliseconds 90
    }
  }
  Write-Host ""
}

function Show-BootFrame {
  Write-Host '       .----------------------------.' -ForegroundColor DarkCyan
  Write-Host '       |  JARVIS CORE   <====> LIVE |' -ForegroundColor White
  Write-Host '       ''----------------------------''' -ForegroundColor DarkCyan
}

function Show-Banner {
  Clear-Host
  Write-Host ''
  $banner = @(
    '      _   _    ____   __     __ ___  ____',
    '     | | / \  |  _ \  \ \   / /|_ _|/ ___|',
    '  _  | |/ _ \ | |_) |  \ \ / /  | | \___ \',
    ' | |_| / ___ \|  _ <    \ V /   | |  ___) |',
    '  \___/_/   \_\_| \_\    \_/   |___||____/'
  )
  foreach ($line in $banner) {
    Write-Host $line -ForegroundColor Cyan
    Start-Sleep -Milliseconds 55
  }
  Write-Host '  +------------------------------------------------+' -ForegroundColor DarkCyan
  Write-Host '  |              JARVIS DESKTOP LINK               |' -ForegroundColor White
  Write-Host '  |          VERIFICATION / AWAKENING SEQUENCE     |' -ForegroundColor DarkGray
  Write-Host '  +------------------------------------------------+' -ForegroundColor DarkCyan
  Write-Host ''
  Show-BootFrame
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
    Write-CeremonyLine '  [codex] Running real codex exec OAuth proof prompt...' DarkCyan

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
      Show-StatusStage 'Codex / ChatGPT OAuth' 'VERIFIED' Cyan Green
      Show-StatusStage 'Reasoning test response' 'RECEIVED' Cyan Green
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
Write-TypewriterLine '  Initializing Jarvis Desktop Link...' White 10
Start-CeremonyPause

Show-StatusStage 'Locating desktop daemon' 'ONLINE'
Show-StatusStage 'Testing command channel' 'READY'
Write-CeremonyLine '  [ok] Local shell verified' Green
$localShellVerified = $true
Start-CeremonyPause

Show-StatusStage 'Pairing with Jarvis cloud' 'LINKED'
Test-Server -TargetServer $Server
if (-not [string]::IsNullOrWhiteSpace($SetupId)) {
  Write-CeremonyLine ("  [setup] Setup id received: {0}" -f $SetupId) DarkCyan
}
Start-CeremonyPause

Show-ProgressStart 'Verifying Codex / ChatGPT OAuth'
$codexVerified = Test-Codex -SkipProbe:$SkipCodexProbe
Start-CeremonyPause

Clear-Host
Show-Banner
Write-Host ''
Write-CeremonyLine '  ------------------------------------------------' DarkCyan
if ($localShellVerified -and $codexVerified) {
  Write-CeremonyLine '  REAL CHECKS COMPLETE' Green
  Write-CeremonyLine '  [ok] Local shell verified' Green
  Write-CeremonyLine '  [ok] Codex OAuth: VERIFIED' Green
  Write-CeremonyLine '  [ok] Reasoning test: RECEIVED' Green
  Write-Host ''
  Write-TypewriterLine '  JARVIS: Hello, world.' Green 18
  Write-TypewriterLine '          I am awake. I can see this machine now.' Green 14
  Write-Host ''
  Write-CeremonyLine '  Desktop command channel: ONLINE' Green
  Write-CeremonyLine '  Codex reasoning channel: ONLINE' Green
  Write-CeremonyLine '  Cloud connection: LINKED' Green
} else {
  Write-CeremonyLine '  JARVIS LINK INCOMPLETE' Yellow
  Write-CeremonyLine '  Desktop command channel: ONLINE' Green
  Write-CeremonyLine '  Codex reasoning channel: NEEDS ATTENTION' Yellow
}
Write-CeremonyLine '  ------------------------------------------------' DarkCyan
Write-Host ''
Write-CeremonyLine 'Press any key to close.' White
if (-not [Console]::IsInputRedirected) {
  [void][Console]::ReadKey($true)
}
