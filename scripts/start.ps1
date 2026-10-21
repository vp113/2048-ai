param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Docker {
  docker info *> $null
  return $LASTEXITCODE -eq 0
}

if (-not (Test-Docker)) {
  $dockerExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path $dockerExe)) {
    throw 'Docker Desktop was not found. Install Docker Desktop first.'
  }
  Write-Host 'Starting Docker Desktop...'
  Start-Process $dockerExe
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 5
    if (Test-Docker) { break }
  }
}

if (-not (Test-Docker)) {
  throw 'Docker is not ready. Start Docker Desktop and run this script again.'
}

$tables = Join-Path $root 'vendor/2048-ai/tables'
New-Item -ItemType Directory -Force -Path $tables | Out-Null

docker image inspect 2048-ai-small *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Building the 2048 AI image (Ubuntu + g++)...'
  docker build -t 2048-ai-small vendor/2048-ai
  if ($LASTEXITCODE -ne 0) { throw 'Docker image build failed.' }
}

$running = docker ps --filter 'name=^/2048-ai$' --format '{{.Names}}'
if ([string]::IsNullOrWhiteSpace($running)) {
  docker rm -f 2048-ai *> $null
  docker run -d --name 2048-ai -p 8080:8080 -v "${tables}:/data" 2048-ai-small | Out-Null
}

$table10 = Join-Path $tables 'tuple_moves.10a'
$table11 = Join-Path $tables 'tuple_moves.11a'
if (-not ((Test-Path $table10) -and (Test-Path $table11))) {
  Write-Host 'First run: generating the 2.5 GB lookup tables (about 4-8 minutes).'
  docker stop 2048-ai | Out-Null
  docker run --rm -v "${tables}:/data" 2048-ai-small /app/2048 -d3 -i1 2050
  if ($LASTEXITCODE -ne 0) { throw 'Lookup table generation failed.' }
  docker start 2048-ai | Out-Null
}

Write-Host 'Waiting for the AI service...'
$ready = $false
for ($i = 0; $i -lt 180; $i++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 'http://localhost:8080/move?board=0000000000000001'
    if ($response.Content.Trim() -match '^[ulrdg]$') {
      $ready = $true
      break
    }
  } catch { }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  Write-Warning 'The AI service did not respond yet. The page may show connecting.'
}

$webUp = $false
try {
  $page = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://localhost:8000/'
  if ($page.StatusCode -eq 200) { $webUp = $true }
} catch { }
if (-not $webUp) {
  $node = Get-Command node -ErrorAction Stop
  if ($NoBrowser) {
    Start-Process -FilePath $node.Source -ArgumentList 'serve.js' -WorkingDirectory $root -WindowStyle Hidden
  } else {
    Start-Process -FilePath $node.Source -ArgumentList 'serve.js' -WorkingDirectory $root
  }
  Start-Sleep -Seconds 1
}

if ($NoBrowser) {
  Write-Host 'Services are ready. Open http://localhost:8000 manually (NoBrowser).'
} else {
  Write-Host 'Opening http://localhost:8000 ...'
  Start-Process 'http://localhost:8000'
}
Write-Host 'AI is ready. Stop with scripts/stop-ai.ps1 or close the Node server window.'
