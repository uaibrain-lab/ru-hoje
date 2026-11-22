# Instalar artefato QA do Externo no checkout local do Hub, sem deploy.
[CmdletBinding()]
param([Parameter(Mandatory=$true,Position=0)][string]$ArtifactZip)
$ErrorActionPreference = 'Stop'
$hub = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$zip = (Resolve-Path -LiteralPath $ArtifactZip).Path
if (-not $zip.EndsWith('.zip',[System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Forneca o ZIP oficial do workflow externo-hub-v1-municipal-sem-rotas'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js precisa estar instalado e no PATH'
}
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("hub-v1-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $temp | Out-Null
try {
    Expand-Archive -LiteralPath $zip -DestinationPath $temp -Force
    $source = $temp
    if (-not (Test-Path (Join-Path $source 'index.html'))) {
        $source = Join-Path $temp 'externo'
    }
    if (-not (Test-Path (Join-Path $source 'hub-v1-qa.json'))) {
        throw 'Artefato sem gate GTFS aprovado. Staging bloqueado.'
    }
    Push-Location $hub
    try {
        & node (Join-Path $hub 'scripts\stage-externo.mjs') $source
        if ($LASTEXITCODE -ne 0) { throw "Staging falhou com codigo $LASTEXITCODE" }
        Write-Host 'HUB_V1_STAGED_LOCALLY_NO_DEPLOY'
        git status --short -- public/externo
    } finally { Pop-Location }
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
