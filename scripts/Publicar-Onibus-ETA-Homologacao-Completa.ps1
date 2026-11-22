# Publica Worker ETA-QA, valida seus endpoints e somente depois publica Firebase preview.
# PowerShell 5.1. Nao altera Worker de producao, Hosting principal nem Firestore.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerRepo = Join-Path $root '_ExternoBH_ETA_QA'
$branch = 'feat/eta-tripupdates-sumob-20261122'
$sha = 'a11b2cad98508a31be69dff6148817bef1f26004'
$remote = 'https://github.com/uaibrain-lab/onibusexternobh.git'
$hostingScript = Join-Path $root 'Publicar-Homologacao.ps1'

if (-not (Test-Path -LiteralPath $hostingScript -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $root 'firebase.json') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $root 'public\interno\index.html') -PathType Leaf)) {
    throw 'Pacote de homologacao incompleto. Extraia o ZIP inteiro em pasta nova.'
}
$firebaseConfig = Get-Content -LiteralPath (Join-Path $root 'firebase.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($firebaseConfig.hosting.public -ne 'public') { throw 'Hosting nao isolado: deploy bloqueado.' }
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw 'Git nao encontrado. Instale Git para Windows e reabra o PowerShell.'
}
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
    throw 'Node.js/npx nao encontrado. Instale Node.js LTS e reabra o PowerShell.'
}
Write-Host 'FASE 1/2: preparar e publicar exclusivamente Worker Cloudflare ETA-QA.'
if (-not (Test-Path -LiteralPath (Join-Path $workerRepo '.git'))) {
    if (Test-Path -LiteralPath $workerRepo) {
        throw "A pasta $workerRepo existe mas nao e um repositorio Git."
    }
    & git.exe clone --single-branch --branch $branch --depth 1 --filter=blob:none $remote $workerRepo
    if ($LASTEXITCODE -ne 0) { throw 'Clone privado falhou: autentique seu GitHub no Git.' }
}
& git.exe -C $workerRepo fetch --depth 1 origin $sha
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel obter o commit QA fixado.' }
& git.exe -C $workerRepo checkout --force --detach $sha
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel fixar a versao do Worker QA.' }
$installed = (& git.exe -C $workerRepo rev-parse HEAD).Trim()
if ($installed -ne $sha) { throw 'Commit do Worker difere da versao validada.' }

$workerScript = Join-Path $workerRepo 'scripts\Publicar-ETA-Worker-Homologacao.ps1'
if (-not (Test-Path -LiteralPath $workerScript -PathType Leaf)) {
    throw 'Script do Worker QA nao existe na versao fixada.'
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $workerScript
if ($LASTEXITCODE -ne 0) {
    throw 'Worker QA nao validado. Firebase Hosting NAO foi publicado.'
}
Write-Host 'FASE 2/2: publicar somente o canal Firebase de homologacao.'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $hostingScript
if ($LASTEXITCODE -ne 0) { throw 'Falha no Hosting de homologacao.' }
Write-Host 'HUB_ONIBUS_ETA_HOMOLOGACAO_COMPLETA_OK'
Write-Host 'Nenhum deploy do Worker de producao ou Hosting principal foi solicitado.'
