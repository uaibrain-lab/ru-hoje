<#
  Hub UFMG - backup periódico opcional de código.
  NÃO executa sem -Acao Instalar. Usa Agendador de Tarefas do Windows 10/11.
  Não faz exportação de Firestore, dados pessoais ou segredos.
  O computador precisa estar ligado e o usuário conectado; StartWhenAvailable
  tenta executar tarefas perdidas quando o Agendador voltar a funcionar.
  Uso:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\HUB-BACKUP-AGENDAR.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\HUB-BACKUP-AGENDAR.ps1 -Acao Instalar -DestinoSecundario "X:\Hub-UFMG"
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\HUB-BACKUP-AGENDAR.ps1 -Acao Remover
#>
param(
  [ValidateSet('Consultar','Instalar','Remover')][string]$Acao='Consultar',
  [string]$DestinoSecundario=''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0
$task='Hub-UFMG-Backup-Semanal'
$backup=Join-Path $PSScriptRoot 'HUB-BACKUP-GIT-LOCAL.ps1'
if(-not(Test-Path -LiteralPath $backup -PathType Leaf)){throw 'BACKUP_SCRIPT_AUSENTE'}
if($Acao -eq 'Consultar'){
  $found=Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  if($null -eq $found){Write-Host 'HUB_BACKUP_SEMANAL_NAO_CONFIGURADO'}
  else{
    $info=Get-ScheduledTaskInfo -TaskName $task
    Write-Host "HUB_BACKUP_SEMANAL_CONFIGURADO Estado=$($found.State) UltimaExecucao=$($info.LastRunTime) Resultado=$($info.LastTaskResult)"
  }
  exit 0
}
if($Acao -eq 'Remover'){
  $found=Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  if($null -ne $found){Unregister-ScheduledTask -TaskName $task -Confirm:$false}
  Write-Host 'HUB_BACKUP_SEMANAL_DESATIVADO'
  exit 0
}
# Nenhum caminho externo é assumido automaticamente. Não armazenar tokens
# ou segredos na tarefa agendada nem introduzir conta com privilégios altos.
if(-not [string]::IsNullOrWhiteSpace($DestinoSecundario) -and
   -not [IO.Path]::IsPathRooted($DestinoSecundario)){
  throw 'DESTINO_SECUNDARIO_DEVE_SER_ABSOLUTO'
}
$arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$backup+'"'
if(-not [string]::IsNullOrWhiteSpace($DestinoSecundario)){
  if($DestinoSecundario.Contains('"')){throw 'DESTINO_SECUNDARIO_INVALIDO'}
  $arguments+=' -DestinoSecundario "'+$DestinoSecundario+'"'
}
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger=New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '19:00'
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Hub UFMG: cópia Git semanal + SHA256 + restauração de teste; não inclui Firestore' -Force | Out-Null
Write-Host 'HUB_BACKUP_SEMANAL_INSTALADO: domingos às 19h, somente quando o usuário estiver conectado.' -ForegroundColor Green
Write-Host 'Atenção: não cobre perda do computador nem dados Firestore; configure cópia secundária em outra unidade.' -ForegroundColor Yellow
