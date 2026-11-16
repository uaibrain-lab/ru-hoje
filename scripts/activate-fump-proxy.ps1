<#
Ativar o Worker Cloudflare APÓS a implantação e validação da FUMP.
Sem Cloud Billing, sem token exposto no app, sem gravações pelo navegador.

Uso (PowerShell Windows):
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\activate-fump-proxy.ps1 -WorkerUrl "https://hub-fump-proxy.SEU-NOME.workers.dev"
#>
param(
  [Parameter(Mandatory = $true)][string]$WorkerUrl,
  [switch]$SkipGithubConfiguration
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repo "public\config.js"
if (!(Test-Path $configPath) -or !(Test-Path (Join-Path $repo "firebase.json"))) {
  throw 'Execute este script da copia do repositorio ru-hoje, nao do UaiBrain.'
}
$uri = [Uri]$WorkerUrl
if ($uri.Scheme -ne 'https' -or !$uri.Host -or ($uri.AbsolutePath -ne '/') -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) {
  throw 'WORKER_URL_INVALIDA: informe apenas a origem HTTPS, sem caminho/query/credenciais.'
}
$origin = $uri.GetLeftPart([System.UriPartial]::Authority).TrimEnd('/')
$config = [System.IO.File]::ReadAllText($configPath)
if ($config -notmatch 'firebaseProjectId:\s*"hubufmg"') {throw 'PROJETO_FIREBASE_DIVERGENTE'}
if ($config -notmatch 'fumpProxyUrl:\s*"[^"]*"') {throw 'CLIENTE_SEM_SUPORTE_PROXY: atualize o repositorio.'}
if (!(Get-Command node -ErrorAction SilentlyContinue)) {throw 'Node.js 22 e obrigatorio.'}
if (!(Get-Command npx.cmd -ErrorAction SilentlyContinue)) {throw 'npm/npx nao encontrados.'}
if (!$SkipGithubConfiguration -and !(Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI (gh) nao encontrado. Instale e autentique, ou use -SkipGithubConfiguration apenas para o site.'
}
$today = (Get-Date).ToString("yyyy-MM-dd")
try {
  $br = [System.TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time')
  $today = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow,$br).ToString('yyyy-MM-dd')
} catch {Write-Warning 'Fuso Brasil nao encontrado; usando a data local do Windows.'}

Write-Host "Verificando CORS, acesso a FUMP e formatos de todos os RUs em $origin ..."
$validated = 0
$positive = 0
foreach($id in @('6','1','2','5')){
  $url = "$origin/api/menu?id=$id&data=$today"
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 25 -Headers @{Origin='https://hubufmg.web.app';Accept='application/json'}
    if ($response.Headers['Access-Control-Allow-Origin'] -ne 'https://hubufmg.web.app') {throw 'CORS_NAO_AUTORIZADO'}
    $data = $response.Content | ConvertFrom-Json
    if ($null -eq $data.cardapios -or ($data.PSObject.Properties.Name -contains 'id' -and [string]$data.id -ne $id)) {
      throw 'JSON_RU_INVALIDO'
    }
    $count = @($data.cardapios).Count
    $dishes = 0
    foreach($day in @($data.cardapios)) {
      foreach($meal in @($day.refeicoes)) {$dishes += @($meal.pratos).Count}
    }
    if ($dishes -gt 0) {$positive++}
    $validated++
    Write-Host "RU $id : OK, cardapios=$count, pratos=$dishes"
  } catch {
    Write-Warning "RU $id : $($_.Exception.Message)"
  }
}
if ($validated -eq 0 -or $positive -eq 0) {
  throw 'NAO_ATIVADO: Worker nao confirmou acesso a nenhum cardapio valido da FUMP. Nao alterei o site.'
}
Write-Host "Rede aprovada em $validated/4 endpoints e $positive resposta(s) com pratos."

Push-Location $repo
try {
  node --test tests/fump-proxy-worker.test.mjs tests/fump-proxy-client.test.mjs
  if ($LASTEXITCODE -ne 0) {throw 'TESTES_PROXY_FALHARAM'}

  if (!$SkipGithubConfiguration) {
    gh variable set FUMP_PUBLIC_PROXY_URL --body $origin --repo uaibrain-lab/ru-hoje
    if ($LASTEXITCODE -ne 0) {throw 'FALHA_CONFIGURACAO_GITHUB'}
    Write-Host 'Variavel FUMP_PUBLIC_PROXY_URL gravada no GitHub.'
  }

  $replacement = 'fumpProxyUrl: "' + $origin + '"'
  $newConfig = [regex]::Replace($config,'fumpProxyUrl:\s*"[^"]*"',$replacement)
  [System.IO.File]::WriteAllText($configPath,$newConfig,(New-Object System.Text.UTF8Encoding($false)))
  npx.cmd --yes firebase-tools@15.22.1 deploy --only hosting --project hubufmg --non-interactive
  if($LASTEXITCODE -ne 0) {throw 'DEPLOY_FIREBASE_FALHOU: confira Firebase login e permissoes.'}
  Write-Host 'Hosting do projeto hubufmg publicado com proxy validado.'

  if (!$SkipGithubConfiguration) {
    gh workflow run hub-production-cardapios.yml --field mode=apply --field recovery=false --repo uaibrain-lab/ru-hoje
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'Hosting OK; workflow de sincronizacao nao foi iniciado. Confira as flags GitHub e permissoes.'
    } else {
      Write-Host 'Sincronizacao manual do Firestore solicitada via GitHub Actions.'
    }
  }
} finally {Pop-Location}
