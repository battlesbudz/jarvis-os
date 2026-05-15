param(
  [string]$TaskName = "Jarvis Codex OAuth Gateway",
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunnerPath = Join-Path $ScriptDir "start-jarvis-oauth-gateway-supervisor.ps1"

if (!(Test-Path $RunnerPath)) {
  throw "Gateway supervisor runner not found: $RunnerPath"
}

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerPath`""

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
Write-Host "Runner: $RunnerPath"

if (!$NoStart) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Started scheduled task: $TaskName"
}
