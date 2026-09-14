$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$env:API_PORT = '3310'
$env:AI_PORT = '3311'
$env:AI_SERVICE_URL = 'http://127.0.0.1:3311'
$runId = [guid]::NewGuid().ToString()
$documentId = $null

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
  $userHeaders = @{
    'Content-Type' = 'application/json'
    'x-dev-user-id' = 'startup-verification'
    'Idempotency-Key' = "startup-profile-$runId"
  }
  $profileBody = '{"education_level":"\u672c\u79d1\u751f"}'
  Invoke-RestMethod -Method Patch -Uri 'http://127.0.0.1:3310/users/me/profile' -Headers $userHeaders -Body $profileBody | Out-Null
  $documentHeaders = @{
    'Content-Type' = 'application/json'
    'x-dev-user-id' = 'startup-verification'
    'Idempotency-Key' = "startup-document-$runId"
  }
  $documentBody = '{"title":"\u542f\u52a8\u9a8c\u8bc1\u5408\u6210\u901a\u77e5","text":"\u9002\u7528\u5bf9\u8c61\uff1a\u672c\u79d1\u751f\n1. \u5b8c\u6210\u542f\u52a8\u9a8c\u8bc1\n\u622a\u6b62\uff1a2099-10-03 17:00 \u524d","data_origin":"synthetic"}'
  $document = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3310/documents' -Headers $documentHeaders -Body $documentBody
  $documentId = $document.document.document_id
  $parseHeaders = @{
    'Content-Type' = 'application/json'
    'x-dev-user-id' = 'startup-verification'
    'Idempotency-Key' = "startup-parse-$runId"
  }
  $parse = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3310/documents/$documentId/parse" -Headers $parseHeaders -Body '{}'
  if ($parse.status -ne 'succeeded' -or $parse.result.verified_actions.Count -ne 1) {
    throw "API to AI parse-chain verification failed: status=$($parse.status), error=$($parse.error.code)"
  }
  Write-Output "PowerShell startup verification passed: API=$($apiHealth.database), AI=$($aiHealth.parser), parse_chain=$($parse.status)"
}
finally {
  if ($documentId) {
    try {
      $cleanupHeaders = @{
        'Content-Type' = 'application/json'
        'x-dev-user-id' = 'startup-verification'
        'Idempotency-Key' = "startup-cleanup-$runId"
      }
      Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:3310/documents/$documentId" -Headers $cleanupHeaders -Body '{"confirmed":true}' | Out-Null
    } catch {
      Write-Warning "Startup verification cleanup failed for synthetic document $documentId"
    }
  }
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
