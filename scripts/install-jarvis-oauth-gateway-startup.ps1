param(
  [string]$TaskName = "Jarvis Codex OAuth Gateway",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$SupervisorPath = Join-Path $ScriptDir "jarvis-oauth-gateway-supervisor.mjs"

if (!(Test-Path $SupervisorPath)) {
  throw "Gateway supervisor not found: $SupervisorPath"
}

$Action = New-ScheduledTaskAction `
  -Execute "node.exe" `
  -Argument "`"$SupervisorPath`"" `
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

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Principal $Principal `
  -Description "Keeps the Jarvis local ChatGPT/Codex OAuth gateway running for hosted Jarvis." `
  -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Runner: node.exe `"$SupervisorPath`""
Write-Host "Working directory: $RepoRoot"

if (!$NoStart) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started scheduled task: $TaskName"
}
