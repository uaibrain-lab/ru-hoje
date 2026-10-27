param([string]$Projeto='D:\Downloads\ru-hoje')
$ErrorActionPreference='Stop'
Set-Location $Projeto
& npm test
if($LASTEXITCODE -ne 0){throw 'Testes unitários reprovados.'}
& npm run test:e2e
if($LASTEXITCODE -ne 0){throw 'Regressão E2E do cardápio reprovada.'}
& npm run test:festas
if($LASTEXITCODE -ne 0){throw 'E2E de festas reprovado.'}
Write-Host 'Testes funcionais aprovados. ATENÇÃO: falta obrigatoriamente testar Firestore Rules no Emulator.' -ForegroundColor Yellow
Write-Host 'Execute: npm run test:festas:security' -ForegroundColor Yellow
Write-Host 'NENHUM deploy, push nem atualização de produção foi feito.' -ForegroundColor Green
