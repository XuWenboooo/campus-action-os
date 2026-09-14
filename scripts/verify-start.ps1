$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$env:API_PORT = '3310'
$env:AI_PORT = '3311'

& $npmCommand run db:migrate
$ai = Start-Process -FilePath $npmCommand -ArgumentList 'run', 'dev:ai' -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
$api = Start-Process -FilePath $npmCommand -ArgumentList 'run', 'dev:api' -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
try {
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 250
    try { $apiHealth = Invoke-RestMethod 'http://127.0.0.1:3310/health'; $aiHealth = Invoke-RestMethod 'http://127.0.0.1:3311/health'; break } catch { }
  } while ((Get-Date) -lt $deadline)
  if ($apiHealth.status -ne 'ok' -or $aiHealth.status -ne 'ok') { throw 'API/AI health check timed out' }
  Write-Output "PowerShell startup verification passed: API=$($apiHealth.database), AI=$($aiHealth.parser)"
}
finally {
  $projectPattern = [regex]::Escape($projectRoot)
  $runtimeProcesses = @(Get-NetTCPConnection -LocalPort 3310,3311 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($processId in $runtimeProcesses) {
    $runtime = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if ($runtime.CommandLine -match $projectPattern -and $runtime.CommandLine -match 'services[/\\](api|ai-parser)[/\\]src[/\\]server\.ts') {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($process in @($api, $ai)) {
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds 250
  if (Get-NetTCPConnection -LocalPort 3310,3311 -State Listen -ErrorAction SilentlyContinue) { throw 'Startup verification left a listening process behind' }
}
