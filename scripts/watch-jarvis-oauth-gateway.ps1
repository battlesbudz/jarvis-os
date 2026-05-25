param(
  [int]$Port = 5000,
  [int]$IntervalSeconds = 10,
  [int]$MissingThreshold = 2
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $Root ".jarvis\logs"
$WatchdogLog = Join-Path $LogDir "jarvis-oauth-gateway-watchdog.log"
$SupervisorScript = Join-Path $PSScriptRoot "start-jarvis-oauth-gateway-supervisor.ps1"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Set-Location $Root

function Write-WatchdogLog {
  param([string]$Message)
  $Line = "[{0}] {1}" -f (Get-Date).ToString("s"), $Message
  Add-Content -LiteralPath $WatchdogLog -Value $Line
}

function Get-GatewayListener {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Get-SupervisorProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe' OR Name = 'node.exe'" |
    Where-Object {
      $_.CommandLine -and
      (
        $_.CommandLine -like "*start-jarvis-oauth-gateway-supervisor.ps1*" -or
        $_.CommandLine -like "*jarvis-oauth-gateway-supervisor.mjs*"
      ) -and
      $_.CommandLine -notlike "*watch-jarvis-oauth-gateway.ps1*" -and
      $_.CommandLine -like "*Gameplanjarvisai*"
    }
}

function Get-OtherWatchdogs {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.CommandLine -and
      $_.CommandLine -like "*watch-jarvis-oauth-gateway.ps1*" -and
      $_.CommandLine -like "*Gameplanjarvisai*"
    }
}

function Start-GatewaySupervisor {
  $Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$SupervisorScript`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $Arguments -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
  Write-WatchdogLog "Started Jarvis OAuth gateway supervisor."
}

function Ensure-TailscaleFunnel {
  try {
    $Status = & tailscale.exe serve status 2>&1 | Out-String
    $Expected = "/               proxy http://127.0.0.1:$Port"
    if ($Status -like "*$Expected*") {
      return
    }
    Write-WatchdogLog "Tailscale root route missing; republishing Funnel to http://127.0.0.1:$Port."
    & tailscale.exe funnel --bg "http://127.0.0.1:$Port" | Out-Null
  } catch {
    Write-WatchdogLog "Could not verify or republish Tailscale Funnel: $($_.Exception.Message)"
  }
}

if (@(Get-OtherWatchdogs).Count -gt 0) {
  Write-WatchdogLog "Another Jarvis OAuth gateway watchdog is already running. Exiting this duplicate instance."
  exit 0
}

$MissingCount = 0
$UnsupervisedCount = 0
$LastDegradedLogAt = [datetime]::MinValue
$LastFunnelCheckAt = [datetime]::MinValue

Write-WatchdogLog "Watchdog started for port $Port from $Root."

while ($true) {
  try {
    $Listener = Get-GatewayListener
    $Supervisors = @(Get-SupervisorProcesses)

    if (((Get-Date) - $LastFunnelCheckAt).TotalSeconds -ge 60) {
      Ensure-TailscaleFunnel
      $LastFunnelCheckAt = Get-Date
    }

    if ($Listener) {
      $MissingCount = 0
      if ($Supervisors.Count -eq 0) {
        $UnsupervisedCount += 1
        if (((Get-Date) - $LastDegradedLogAt).TotalMinutes -ge 5) {
          Write-WatchdogLog "Gateway is listening on port $Port, but no supervisor process was found."
          $LastDegradedLogAt = Get-Date
        }
        if ($UnsupervisedCount -ge $MissingThreshold) {
          Write-WatchdogLog "Gateway listener is healthy but unsupervised. Leaving it running to avoid unnecessary restarts."
          $UnsupervisedCount = 0
        }
      } else {
        $UnsupervisedCount = 0
      }
    } else {
      $MissingCount += 1
      $UnsupervisedCount = 0
      Write-WatchdogLog "Gateway listener missing on port $Port ($MissingCount/$MissingThreshold). Supervisor processes: $($Supervisors.Count)."

      if ($MissingCount -ge $MissingThreshold) {
        foreach ($Supervisor in $Supervisors) {
          try {
            Stop-Process -Id $Supervisor.ProcessId -Force -ErrorAction Stop
            Write-WatchdogLog "Stopped stale supervisor process $($Supervisor.ProcessId)."
          } catch {
            Write-WatchdogLog "Could not stop supervisor process $($Supervisor.ProcessId): $($_.Exception.Message)"
          }
        }
        Start-GatewaySupervisor
        $MissingCount = 0
      }
    }
  } catch {
    Write-WatchdogLog "Watchdog error: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $IntervalSeconds
}
