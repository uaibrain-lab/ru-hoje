<#
 Hub UFMG: snapshot local independente do GitHub.
 Arquiva historico Git, branches e tags; nao inclui dados do Firestore
 nem segredos do Firebase/Cloudflare.
 Restaure: git clone <backup.bundle> <destino>
#>
param(
  [string]$Destino = "$env:USERPROFILE\Documents\Hub-UFMG-Backups",
  # Opcional e explicito: unidade USB/compartilhamento de rede/sync em outra conta.
  # Nunca recebe dados do Firestore nem segredos.
  [string]$DestinoSecundario = ""
)
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
# Verificar uma restauração real (git clone em diretório temporário) para
# detectar bundle incompleto antes de declarar backup válido.
& node "$PSScriptRoot\verify-hub-bundle.mjs" --bundle $bundle
if($LASTEXITCODE -ne 0){throw "BUNDLE_RESTAURACAO_FALHOU"}
if (-not [string]::IsNullOrWhiteSpace($DestinoSecundario)) {
  if (-not [IO.Path]::IsPathRooted($DestinoSecundario)) {
    throw "DESTINO_SECUNDARIO_DEVE_SER_ABSOLUTO"
  }
  $primaryFull=[IO.Path]::GetFullPath($Destino).TrimEnd('\')
  $secondaryFull=[IO.Path]::GetFullPath($DestinoSecundario).TrimEnd('\')
  if ([string]::Equals($primaryFull,$secondaryFull,[StringComparison]::OrdinalIgnoreCase)) {
    throw "DESTINO_SECUNDARIO_IGUAL_AO_PRIMARIO"
  }
  New-Item -ItemType Directory -Force -Path $secondaryFull | Out-Null
  $copy=Join-Path $secondaryFull (Split-Path -Leaf $bundle)
  $copyManifest="$copy.sha256"
  # Não substituir silenciosamente uma cópia existente.
  if ((Test-Path -LiteralPath $copy) -or (Test-Path -LiteralPath $copyManifest)) {
    throw "BACKUP_SECUNDARIO_JA_EXISTE"
  }
  Copy-Item -LiteralPath $bundle -Destination $copy -ErrorAction Stop
  Copy-Item -LiteralPath $manifest -Destination $copyManifest -ErrorAction Stop
  $secondaryHash=(Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
  if ($secondaryHash -ne $hash.Hash) { throw "BACKUP_SECUNDARIO_SHA256_DIVERGENTE" }
  & node "$PSScriptRoot\verify-hub-bundle.mjs" --bundle $copy
  if($LASTEXITCODE -ne 0){throw "BACKUP_SECUNDARIO_RESTAURACAO_FALHOU"}
  Write-Host "BACKUP_SECUNDARIO_VERIFICADO: $copy" -ForegroundColor Green
  if ([IO.Path]::GetPathRoot($primaryFull) -eq [IO.Path]::GetPathRoot($secondaryFull)) {
    Write-Warning "As duas copias estao na mesma unidade. Isso nao protege de perda total da unidade."
  }
}
Write-Host "BACKUP_GIT_VALIDADO: $bundle" -ForegroundColor Green
Write-Host "SHA256: $($hash.Hash)"
Write-Host "Aviso: dados privados do Firestore e segredos de provedores NAO estao neste arquivo."
