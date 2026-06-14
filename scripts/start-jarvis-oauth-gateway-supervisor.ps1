$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$LogDir = Join-Path $RepoRoot ".jarvis\logs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $RepoRoot

$env:JARVIS_OAUTH_GATEWAY_LOG_DIR = $LogDir

if (!$env:JARVIS_CODEX_COMMAND) {
  $CodexCandidates = @(
    (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin\codex.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\codex.exe"),
    "C:\Program Files\WindowsApps\OpenAI.Codex_26.506.3741.0_x64__2p2nqsd0c76g0\app\resources\codex.exe"
  )

  $NestedCodex = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin") -Recurse -Filter codex.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if ($NestedCodex) {
    $CodexCandidates = @($NestedCodex) + $CodexCandidates
  }

  foreach ($Candidate in $CodexCandidates) {
    if ($Candidate -and (Test-Path $Candidate)) {
      $env:JARVIS_CODEX_COMMAND = $Candidate
      break
    }
  }
}

$NodeCandidates = @(
  (Join-Path (Split-Path -Parent $RepoRoot) ".tools\node-v22.22.3-win-x64\node.exe"),
  (Join-Path $RepoRoot ".tools\node-v22.22.3-win-x64\node.exe"),
  "node.exe"
)

$NodeExe = $NodeCandidates | Where-Object { $_ -eq "node.exe" -or (Test-Path $_) } | Select-Object -First 1
& $NodeExe "scripts\jarvis-oauth-gateway-supervisor.mjs"
exit $LASTEXITCODE
