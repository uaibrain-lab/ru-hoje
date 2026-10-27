# Executa SOMENTE servidor HTTP local. Não conecta ao Firebase para inscrições.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$uri = 'http://127.0.0.1:8760/?festas-demo=1'
Write-Host 'Bandeco Festas — DEMONSTRACAO LOCAL. Nenhum deploy.' -ForegroundColor Green
Write-Host "Abrindo $uri" -ForegroundColor Cyan
Start-Process $uri
try { py -3 -m http.server 8760 --bind 127.0.0.1 --directory public }
catch { python -m http.server 8760 --bind 127.0.0.1 --directory public }
