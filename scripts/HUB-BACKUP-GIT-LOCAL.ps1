<#
 Hub UFMG: snapshot local independente do GitHub.
 Arquiva historico Git, branches e tags; nao inclui dados do Firestore
 nem segredos do Firebase/Cloudflare.
 Restaure: git clone <backup.bundle> <destino>
#>
param([string]$Destino = "$env:USERPROFILE\Documents\Hub-UFMG-Backups")
$ErrorActionPreference="Stop"
$repo=Split-Path -Parent $PSScriptRoot
if(-not(Test-Path -LiteralPath $Destino -PathType Container)){
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
}
$stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$bundle=Join-Path $Destino "Hub-UFMG-$stamp.bundle"
& git -C $repo bundle create $bundle --all
if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $bundle)){throw "GIT_BUNDLE_FALHOU"}
& git -C $repo bundle verify $bundle
if($LASTEXITCODE -ne 0){throw "BUNDLE_INTEGRIDADE_FALHOU"}
$hash=Get-FileHash -LiteralPath $bundle -Algorithm SHA256
$manifest="$bundle.sha256"
Set-Content -LiteralPath $manifest -Encoding ASCII -Value "$($hash.Hash)  $(Split-Path -Leaf $bundle)"
Write-Host "BACKUP_GIT_VALIDADO: $bundle" -ForegroundColor Green
Write-Host "SHA256: $($hash.Hash)"
Write-Host "Aviso: dados privados do Firestore e segredos de provedores NAO estao neste arquivo."
