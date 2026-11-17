<#
 Hub UFMG - deploy unificado apos aprovacao do batch (Fases 3, 4 e 5).
 Deploy de Hosting + Firestore Rules; NAO altera o Cloudflare Worker
 (ja publicado na Fase 2) nem executa sorteios.
 Windows PowerShell 5.1, necessita Firebase CLI autenticada.
#>
$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$repo=Split-Path -Parent $PSScriptRoot
Set-Location $repo
if ((& git branch --show-current) -ne "main") { throw "BRANCH_DEVE_SER_MAIN" }
& git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw "GIT_PULL_FALHOU" }
Write-Host "Criando backup local independente antes do deploy..." -ForegroundColor Cyan
$backupArgs=@("-NoProfile","-ExecutionPolicy","Bypass","-File","$PSScriptRoot\HUB-BACKUP-GIT-LOCAL.ps1")
if(-not [string]::IsNullOrWhiteSpace($env:HUB_BACKUP_SECONDARY_PATH)){
  $backupArgs+=@("-DestinoSecundario",$env:HUB_BACKUP_SECONDARY_PATH)
}
& powershell.exe @backupArgs
if($LASTEXITCODE -ne 0){throw "BACKUP_GIT_FALHOU"}
$sha=(& git rev-parse --short HEAD) -join ""
Write-Host "Commit local: $sha"
$swFile=Get-Content -LiteralPath "public\service-worker.js" -Raw
if (-not $swFile.Contains("hub-v277-20261117-batch3-5-r1")) { throw "CODIGO_BATCH_NAO_ENCONTRADO" }
$required=@("public\assets\vendor\leaflet-1.9.4.js","public\assets\vendor\leaflet-1.9.4.css",
    "public\assets\vendor\LICENSE-LEAFLET","firestore.rules")
foreach($file in $required){if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw "ARQUIVO_AUSENTE: $file"}}
Write-Host "Conferindo protecoes locais..." -ForegroundColor Cyan
& node scripts/hub-phase0-readonly-audit.mjs
if($LASTEXITCODE -ne 0){throw "AUDITORIA_FALHOU"}

Write-Host "Publicando uma vez Hosting e Firestore Rules..." -ForegroundColor Cyan
& npx.cmd --yes firebase-tools@15.22.1 deploy --only "hosting,firestore:rules" --project hubufmg --non-interactive
if($LASTEXITCODE -ne 0){throw "FIREBASE_DEPLOY_FALHOU"}

$nonce=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$base="https://hubufmg.web.app"
function Get-PublicText([string]$url) {
  $out=(& curl.exe -fsSL --max-time 35 "$url") -join ""
  if($LASTEXITCODE -ne 0){throw "PUBLIC_URL_FALHOU: $url"}
  return $out
}
$sw=Get-PublicText "$base/service-worker.js?v=$nonce"
$app=Get-PublicText "$base/assets/app.js?v=$nonce"
$interno=Get-PublicText "$base/interno?v=$nonce"
$leaflet=Get-PublicText "$base/assets/vendor/leaflet-1.9.4.js?v=$nonce"
$leafletCSS=Get-PublicText "$base/assets/vendor/leaflet-1.9.4.css?v=$nonce"
if(-not $sw.Contains("hub-v277-20261117-batch3-5-r1")){throw "SW_NAO_ATUALIZADO"}
if(-not $app.Contains("ruhoje:prefetch-quota:v3")){throw "PREFETCH_NAO_ATUALIZADO"}
if(-not $interno.Contains('src="/assets/vendor/leaflet-1.9.4.js"')){throw "INTERNO_NAO_ATUALIZADO"}
if(-not $leaflet.Contains("Leaflet 1.9.4") -and -not $leaflet.Contains("Leaflet v1.9.4")){throw "LEAFLET_INVALIDO"}
if(-not $leafletCSS.Contains(".leaflet-container")){throw "CSS_LEAFLET_INVALIDO"}
Write-Host "HUB_BATCH_FASES_3_4_5_PUBLICADO_E_VERIFICADO" -ForegroundColor Green
Write-Host "OBS: as regras Firestore foram publicadas pelo CLI; a checagem HTTP confirma os arquivos Hosting." -ForegroundColor Yellow
