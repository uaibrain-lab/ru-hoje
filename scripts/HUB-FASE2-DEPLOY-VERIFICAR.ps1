<#
  HUB UFMG FASE 2: deploy sequencial, PowerShell 5.1.
  Uso: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\HUB-FASE2-DEPLOY-VERIFICAR.ps1
  Somente diagnostico: ... -SomenteVerificar
  Nao mexe em Firestore Rules, dados ou sorteios.
#>
param([switch]$SomenteVerificar)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Header-Value([string]$Headers, [string]$Name) {
    $m = [regex]::Matches($Headers, "(?im)^" + [regex]::Escape($Name) + ":\s*([^\r\n]*)")
    if ($m.Count -eq 0) { return "" }
    return $m[$m.Count - 1].Groups[1].Value.Trim()
}

if (-not $SomenteVerificar) {
    $branch = (& git branch --show-current) -join ""
    if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne "main") {
        throw "Execute a partir da branch main; nao alterei o repositorio."
    }
    & git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw "GIT_PULL_FALHOU" }

    Write-Host "PUBLICANDO WORKER" -ForegroundColor Cyan
    & npx.cmd --yes wrangler deploy --config worker/wrangler.toml
    if ($LASTEXITCODE -ne 0) { throw "WORKER_DEPLOY_FALHOU" }
}

Write-Host "DIAGNOSTICO REAL DO WORKER" -ForegroundColor Cyan
$brasilia = [TimeZoneInfo]::FindSystemTimeZoneById("E. South America Standard Time")
$data = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow,$brasilia).ToString("yyyy-MM-dd")
$url = "https://hub-fump-proxy.hubufmg.workers.dev/api/menu?id=6&data=$data"
$tempHeaders = [IO.Path]::GetTempFileName()
$tempBody = [IO.Path]::GetTempFileName()
try {
    $status = (& curl.exe -sS --http1.1 --max-time 30 -H "Origin: https://hubufmg.web.app" -H "Accept: application/json" -H "Cache-Control: no-cache" -D $tempHeaders -o $tempBody -w "%{http_code}" $url) -join ""
    if ($LASTEXITCODE -ne 0) { throw "WORKER_CONSULTA_FALHOU" }
    $headers = Get-Content -LiteralPath $tempHeaders -Raw -Encoding UTF8
    $cc = Header-Value $headers "Cache-Control"
    $timestamp = Header-Value $headers "X-Menu-Fetched-At"
    $cors = Header-Value $headers "Access-Control-Allow-Origin"
    $menuCache = Header-Value $headers "X-Menu-Cache"
    $cfCache = Header-Value $headers "CF-Cache-Status"
    $age = Header-Value $headers "Age"
    Write-Host "HTTP: $status"
    Write-Host "Cache-Control: $cc"
    Write-Host "X-Menu-Fetched-At: $timestamp"
    Write-Host "X-Menu-Cache: $menuCache | CF-Cache-Status: $cfCache | Age: $age"
    Write-Host "CORS: $cors"
    if ($status -ne "200") {
        $detail=Get-Content -LiteralPath $tempBody -Raw -Encoding UTF8
        Write-Host ("Resposta: " + $detail.Substring(0,[Math]::Min(450,$detail.Length))) -ForegroundColor Yellow
        throw "WORKER_HTTP_$status - Hosting nao foi publicado"
    }
    if ($cors -ne "https://hubufmg.web.app") { throw "CORS_INCORRETO" }
    $maxAge=[regex]::Match($cc,'(?i)(?:^|,)\s*max-age\s*=\s*(\d+)(?:\s*,|$)')
    if (-not $maxAge.Success) {
        throw "CACHE_CONTROL_SEM_MAX_AGE: $cc"
    }
    $seconds = [int]$maxAge.Groups[1].Value
    if ($seconds -lt 0 -or $seconds -gt 60 -or $cc -match '(?i)(?:^|,)\s*stale-if-error\b') {
        throw "CACHE_CONTROL_ANTIGO: $cc"
    }
    if ([string]::IsNullOrWhiteSpace($timestamp)) { throw "WORKER_SEM_TIMESTAMP" }
    try { $when=[DateTimeOffset]::Parse($timestamp).ToUniversalTime() }
    catch { throw "WORKER_TIMESTAMP_INVALIDO: $timestamp" }
    $idade=([DateTimeOffset]::UtcNow-$when).TotalSeconds
    Write-Host ("Idade da coleta: {0:N1}s" -f $idade)
    if ($idade -gt 75 -or $idade -lt -10) {
        throw "WORKER_TIMESTAMP_VENCIDO_OU_FUTURO: $timestamp"
    }
    try { $json = Get-Content -LiteralPath $tempBody -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "WORKER_JSON_INVALIDO" }
    if ($null -eq $json -or $null -eq $json.PSObject.Properties["cardapios"]) {
        throw "WORKER_SCHEMA_INVALIDO"
    }
    Write-Host "WORKER_FASE2_OK: somente uma camada de cache, no maximo 60s." -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $tempHeaders,$tempBody -Force -ErrorAction SilentlyContinue
}

if ($SomenteVerificar) {
    Write-Host "SOMENTE_VERIFICACAO: nenhum deploy realizado." -ForegroundColor Green
    exit 0
}

Write-Host "PUBLICANDO FIREBASE HOSTING" -ForegroundColor Cyan
& npx.cmd --yes firebase-tools@15.22.1 deploy --only hosting --project hubufmg --non-interactive
if ($LASTEXITCODE -ne 0) { throw "HOSTING_DEPLOY_FALHOU" }

$nonce=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$base="https://hubufmg.web.app"
$sw=(& curl.exe -fsSL --max-time 30 "$base/service-worker.js?v=$nonce") -join ""
if($LASTEXITCODE -ne 0 -or -not $sw.Contains('hub-v276-20261117-fresh-menus-r1')) {
    throw "SERVICE_WORKER_NAO_ATUALIZADO"
}
$app=(& curl.exe -fsSL --max-time 30 "$base/assets/app.js?v=$nonce") -join ""
if($LASTEXITCODE -ne 0 -or -not $app.Contains('const minimumGapMs=force && !background ? 30_000 : 60_000')) {
    throw "APP_NAO_ATUALIZADO"
}
Write-Host "HUB_FASE2_V276_PUBLICADO_E_VERIFICADO" -ForegroundColor Green
