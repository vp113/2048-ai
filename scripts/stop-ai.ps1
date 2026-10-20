$ErrorActionPreference = 'SilentlyContinue'
docker stop 2048-ai | Out-Null
$connection = Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object -First 1
if ($connection) {
  Stop-Process -Id $connection.OwningProcess -Force
}
Write-Host 'Stopped the AI container and the local page server (if running).'
