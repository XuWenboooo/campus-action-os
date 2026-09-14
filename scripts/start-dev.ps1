param(
  [int]$ApiPort = 3000,
  [int]$AiPort = 3001
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$env:API_PORT = $ApiPort
$env:AI_PORT = $AiPort

& $npmCommand run db:migrate
$ai = Start-Process -FilePath $npmCommand -ArgumentList 'run', 'dev:ai' -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
$api = Start-Process -FilePath $npmCommand -ArgumentList 'run', 'dev:api' -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden
Write-Output "Campus Action OS started: API http://localhost:$ApiPort, AI http://localhost:$AiPort"
Write-Output "API PID=$($api.Id); AI PID=$($ai.Id)"
Write-Output 'Stop with: Stop-Process -Id <API PID>, <AI PID>'
