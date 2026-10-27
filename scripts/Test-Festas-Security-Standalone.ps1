#requires -Version 5.1
<#
Bandeco v2.6.0-RC1.4 — suite estrita e local do Auth/Firestore Emulator.
Substitui o mecanismo de supervisao do RC1.3 sem alterar Rules, dados ou site.
O problema historico de exit 2 em firebase emulators:exec NAO e declarado corrigido:
esta suite executa firebase emulators:start como processo proprio e verifica
separadamente: readiness, retorno Node, marcadores, isolamento e limpeza.
#>
[CmdletBinding()]
param(
    [ValidateSet('Full','Security','Admin')]
    [string]$Suite = 'Full'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$project = 'demo-bandeco'
$ports = @(8080,9099,4400,4500,9150,4000)
$emulatorProc = $null
$emulatorRootStart = $null
$started = $false
$passed = 0
$failure = $null
$cleanupGood = $false
$logPrefix = $null

function Test-LocalPort([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(300)) { return $false }
        try { $client.EndConnect($async); return $true }
        catch { return $false }
    }
    catch { return $false }
    finally { $client.Close() }
}

function Get-OccupiedPorts {
    $occupied = @()
    foreach ($port in $ports) {
        if (Test-LocalPort $port) { $occupied += $port }
    }
    return $occupied
}

function Assert-LocalDemoConfig {
    foreach ($relative in @('firebase.emulators.json','firestore.rules','package.json')) {
        $path = Join-Path $repo $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "BLOQUEADO: arquivo obrigatorio ausente: $path"
        }
    }
    $config = Get-Content (Join-Path $repo 'firebase.emulators.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.firestore.rules -ne 'firestore.rules' -or
        $config.emulators.auth.host -ne '127.0.0.1' -or
        [int]$config.emulators.auth.port -ne 9099 -or
        $config.emulators.firestore.host -ne '127.0.0.1' -or
        [int]$config.emulators.firestore.port -ne 8080 -or
        $config.emulators.ui.enabled -ne $false) {
        throw 'BLOQUEADO: configuracao do Emulator incompatível com a suite RC1.4.'
    }
}

function Get-FirebaseCliJs {
    # Executar diretamente com node elimina a arvore extra do shim firebase.cmd.
    # Aceita apenas caminhos conhecidos do pacote npm firebase-tools.
    $candidates = @((Join-Path $repo 'node_modules\firebase-tools\lib\bin\firebase.js'))
    $shim = Get-Command firebase.cmd -ErrorAction SilentlyContinue
    if ($null -ne $shim) {
        $shimDir = Split-Path $shim.Source -Parent
        $candidates += (Join-Path $shimDir 'node_modules\firebase-tools\lib\bin\firebase.js')
    }
    if ($env:APPDATA) {
        $candidates += (Join-Path $env:APPDATA 'npm\node_modules\firebase-tools\lib\bin\firebase.js')
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'BLOQUEADO: firebase-tools/lib/bin/firebase.js nao localizado. Nao iniciar outro comando ou baixar automaticamente.'
}

function Wait-Ready([object]$Process, [string]$LogPath) {
    for ($i = 0; $i -lt 180; $i++) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "Firebase CLI saiu antes da prontidao (exit=$($Process.ExitCode)). Consulte o log de inicializacao."
        }
        if ((Test-LocalPort 8080) -and (Test-LocalPort 9099)) {
            if (Test-Path -LiteralPath $LogPath) {
                $body = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
                if ($null -ne $body -and $body -match 'All emulators ready') { return }
            }
        }
        Start-Sleep -Milliseconds 500
    }
    throw 'Timeout: Auth/Firestore nao ficaram prontos em 90s.'
}

function Get-OwnedTree([int]$RootProcessId, [datetime]$RootStartUtc) {
    # Apenas descendentes do processo iniciado por este script. Nenhuma busca
    # por nome generico java.exe/node.exe e nenhum taskkill /T global.
    $all = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $result = @()
    $seen = @{}
    $frontier = @([pscustomobject]@{ Id = $RootProcessId; Depth = 0 })
    while ($frontier.Count -gt 0) {
        $next = @()
        foreach ($cursor in $frontier) {
            $matches = @($all | Where-Object { [int]$_.ProcessId -eq [int]$cursor.Id })
            foreach ($proc in $matches) {
                $processId = [int]$proc.ProcessId
                if ($seen.ContainsKey($processId)) { continue }
                $createdUtc = ([datetime]$proc.CreationDate).ToUniversalTime()
                # Nao tocar em processo anterior ou PID reutilizado.
                if ($createdUtc -lt $RootStartUtc.AddSeconds(-5)) { continue }
                if ($processId -eq $RootProcessId -and
                    [math]::Abs(($createdUtc - $RootStartUtc).TotalSeconds) -gt 5) {
                    throw 'BLOQUEADO: PID raiz foi reutilizado; nenhuma terminacao sera tentada.'
                }
                $seen[$processId] = $true
                $result += [pscustomobject]@{
                    Id = $processId
                    Depth = [int]$cursor.Depth
                    StartUtc = $createdUtc
                }
                foreach ($child in @($all | Where-Object { [int]$_.ParentProcessId -eq $processId })) {
                    $next += [pscustomobject]@{ Id = [int]$child.ProcessId; Depth = [int]$cursor.Depth + 1 }
                }
            }
        }
        $frontier = @($next)
    }
    return $result
}

function Stop-OwnedTree([object]$Process, [datetime]$RootStartUtc) {
    $snapshot = @(Get-OwnedTree -RootProcessId $Process.Id -RootStartUtc $RootStartUtc)
    if ($snapshot.Count -eq 0) {
        # Pode ter encerrado sozinho antes de chegar aqui, mas NAO presume
        # que filhos soltos foram eliminados: a checagem de portas continua.
        Write-Host '[LIMPEZA] Processo principal ja terminou; verificando portas locais.'
        return
    }
    foreach ($item in @($snapshot | Sort-Object -Property Depth -Descending)) {
        $live = Get-Process -Id $item.Id -ErrorAction SilentlyContinue
        if ($null -eq $live) { continue }
        try { $liveStartUtc = $live.StartTime.ToUniversalTime() }
        catch { throw "BLOQUEADO: nao foi possivel conferir a identidade do PID $($item.Id)." }
        if ([math]::Abs(($liveStartUtc - $item.StartUtc).TotalSeconds) -gt 5) {
            throw "BLOQUEADO: PID $($item.Id) foi reutilizado; limpeza interrompida."
        }
        Write-Host "[LIMPEZA] Finalizando descendente confirmado PID=$($item.Id) profundidade=$($item.Depth)"
        Stop-Process -Id $item.Id -Force -ErrorAction Stop
    }
    Start-Sleep -Milliseconds 600
    foreach ($item in $snapshot) {
        $live = Get-Process -Id $item.Id -ErrorAction SilentlyContinue
        if ($null -ne $live) {
            try { $liveStartUtc = $live.StartTime.ToUniversalTime() }
            catch { throw "BLOQUEADO: nao foi possivel confirmar o fim do PID $($item.Id)." }
            if ([math]::Abs(($liveStartUtc - $item.StartUtc).TotalSeconds) -le 5) {
                throw "BLOQUEADO: processo da suite ainda ativo: PID=$($item.Id)"
            }
        }
    }
}

$checksAll = @(
    @{ File='scripts/test-festas-security-emulator.mjs'; Marker='SEGURANÇA EMULADOR:'; Name='seguranca' },
    @{ File='scripts/test-festas-security-adversarial.mjs'; Marker='SEGURANÇA ADVERSARIAL:'; Name='adversarial' },
    @{ File='scripts/test-festas-deletion-emulator.mjs'; Marker='EXCLUSÃO EMULADOR:'; Name='exclusao' },
    @{ File='scripts/test-festas-v253-admin-emulator.mjs'; Marker='ADMIN V2.5.3 EMULADOR aprovado:'; Name='administracao' }
)
if ($Suite -eq 'Admin') {
    $checks = @($checksAll[3],$checksAll[0])
} else {
    # Security/full executam os quatro testes; superset do test:festas:security antigo.
    $checks = $checksAll
}
$expected = $checks.Count

Push-Location $repo
try {
    Assert-LocalDemoConfig
    $initial = @(Get-OccupiedPorts)
    if ($initial.Count -gt 0) {
        throw "BLOQUEADO: portas de Emulator ja ocupadas: $($initial -join ', '). Nao encerrar processos estrangeiros."
    }
    # Get-CimInstance e obrigatorio para encerrar apenas o processo que abrimos.
    $selfProc = @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop)
    if ($selfProc.Count -ne 1) { throw 'BLOQUEADO: Win32_Process/CIM indisponivel.' }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $node) { throw 'BLOQUEADO: Node.js nao encontrado.' }
    $cliJs = Get-FirebaseCliJs

    $logsDir = Join-Path $repo 'diagnostics'
    if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
    $runId = (Get-Date -Format 'yyyyMMdd-HHmmss-fff')
    $logPrefix = Join-Path $logsDir "emulator-rc14-$runId"
    $cliOut = "$logPrefix-cli-out.log"
    $cliErr = "$logPrefix-cli-err.log"

    # Configurar ANTES do spawn, tambem para o filho Firebase CLI.
    $env:NO_UPDATE_NOTIFIER = '1'
    $env:CI = '1'
    $env:GCLOUD_PROJECT = $project
    $env:GOOGLE_CLOUD_PROJECT = $project
    $env:FIREBASE_PROJECT_ID = $project
    $env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
    $env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
    $env:FIREBASE_CONFIG = '{"projectId":"demo-bandeco"}'
    Remove-Item Env:\GOOGLE_APPLICATION_CREDENTIALS -ErrorAction SilentlyContinue
    Remove-Item Env:\FIREBASE_TOKEN -ErrorAction SilentlyContinue

    $argsCli = @(( '"' + $cliJs + '"' ), 'emulators:start', '--config', 'firebase.emulators.json',
        '--project', $project, '--only', 'auth,firestore')
    Write-Host "[TESTE] $($Suite): Node -> Firebase CLI npm diretamente, somente $project, emuladores locais."
    $emulatorProc = Start-Process -FilePath $node.Source -ArgumentList $argsCli -PassThru `
        -WorkingDirectory $repo -RedirectStandardOutput $cliOut -RedirectStandardError $cliErr
    $started = $true
    $emulatorRootStart = $emulatorProc.StartTime.ToUniversalTime()
    Wait-Ready $emulatorProc $cliOut
    Write-Host '[APROVADO] Auth/Firestore: portas abertas e prontidao confirmada pela CLI.'

    foreach ($check in $checks) {
        $emulatorProc.Refresh()
        if ($emulatorProc.HasExited -or -not (Test-LocalPort 8080) -or -not (Test-LocalPort 9099)) {
            throw 'BLOQUEADO: processo Firebase ou porta do Emulator indisponivel durante os testes.'
        }
        $scriptPath = Join-Path $repo $check.File
        if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
            throw "BLOQUEADO: teste ausente: $($check.File)"
        }
        $testOut = "$logPrefix-$($check.Name)-out.log"
        $testErr = "$logPrefix-$($check.Name)-err.log"
        Write-Host "[TESTE] $($check.Name): $($check.File)"
        $testProcess = Start-Process -FilePath $node.Source -ArgumentList @( '"' + $scriptPath + '"' ) `
            -WorkingDirectory $repo -PassThru -Wait -RedirectStandardOutput $testOut -RedirectStandardError $testErr
        $resultText = Get-Content -LiteralPath $testOut -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($null -eq $resultText) { $resultText = '' }
        if ($testProcess.ExitCode -ne 0 -or -not $resultText.Contains($check.Marker)) {
            throw "FALHOU $($check.Name): exit=$($testProcess.ExitCode), marcador presente=$($resultText.Contains($check.Marker)); logs $testOut e $testErr"
        }
        $emulatorProc.Refresh()
        if ($emulatorProc.HasExited) { throw 'BLOQUEADO: Firebase CLI caiu durante a suite.' }
        $passed++
        Write-Host "[APROVADO] $($check.Name): Node exit=0 e marcador confirmado."
    }
}
catch {
    $failure = $_.Exception.Message
    Write-Host "[BLOQUEADO] $failure"
}
finally {
    try {
        if ($started -and $null -ne $emulatorProc) {
            Write-Host "[LIMPEZA] Verificacao CIM por descendencia da raiz PID=$($emulatorProc.Id); sem taskkill."
            Stop-OwnedTree -Process $emulatorProc -RootStartUtc $emulatorRootStart
        }
        for ($i = 0; $i -lt 40; $i++) {
            $remaining = @(Get-OccupiedPorts)
            if ($remaining.Count -eq 0) { break }
            Start-Sleep -Milliseconds 250
        }
        $remaining = @(Get-OccupiedPorts)
        $cleanupGood = ($remaining.Count -eq 0)
        if (-not $cleanupGood) {
            throw "Portas locais ainda ocupadas apos limpeza: $($remaining -join ', ')"
        }
        Write-Host '[LIMPEZA] Nenhuma porta reservada do Emulator permanece aberta.'
    }
    catch {
        $cleanupGood = $false
        if ($null -eq $failure) { $failure = "LIMPEZA: $($_.Exception.Message)" }
        Write-Host "[BLOQUEADO] LIMPEZA: $($_.Exception.Message)"
    }
    finally {
        Pop-Location
    }
}

if ($null -ne $failure -or $passed -ne $expected -or -not $cleanupGood) {
    Write-Host "[REPROVADO] suite=$Suite testes_confirmados=$passed/$expected encerramento_local_limpo=$cleanupGood"
    exit 1
}
Write-Host "[APROVADO] RC1.4 suite=$Suite testes_confirmados=$passed/$expected encerramento_local_limpo=True"
Write-Host '[NOTA] O exit code 2 do emulators:exec legado NAO foi corrigido nem normalizado; este e outro runner, independente.'
exit 0
