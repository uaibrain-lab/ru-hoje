# Hub UFMG — Fase 0: auditoria e baseline

Data da auditoria do codigo: **17/11/2026**. Escopo: **uaibrain-lab/ru-hoje**.

Esta etapa e somente leitura operacional: nao faz deploy, nenhuma escrita em Firestore, nenhum disparo de sorteio e nenhuma alteracao de cardapio.

## 1. Referencia anterior ao roadmap

- Commit da main antes de iniciar: d36a593889bd011d89c4c199f0a90898e00cb48f.
- Branch de referencia criada: baseline/hub-pre-roadmap-20261117-d36a593.
- GitHub Actions Validar projeto aprovou este commit (run 44037114781).
- Service Worker no repositorio: hub-v273-20261117-uniform-stop-markers-r1.
- Infraestrutura: Firebase Hosting projeto hubufmg; Worker Cloudflare hub-fump-proxy.
- **Nao confundir codigo no GitHub com versao em producao.** A implantacao real precisa ser verificada via HTTP antes de publicar/voltar versoes.
- **Nao e backup independente:** a branch de referencia esta no mesmo GitHub, pode ser excluida. Um backup externo sera tratado na Fase 8.
- API de branch protection devolveu acesso negado; a consulta de rulesets retornou lista vazia. Nao foi possivel confirmar protecao contra alteracao/exclusao da referencia.

## 2. Inventario real e riscos

| Subsistema | Estado observado | Acao futura |
| --- | --- | --- |
| Cardapios | App consulta Cloudflare Worker -> FUMP oficial (quatro IDs permitidos); Worker sem endpoint de escrita | Manter FUMP como autoridade unica |
| Persistencia legada | app.js ainda usa localStorage para menus, Firestore publicMenus/current e fallback JSON estatico | Remover de modo controlado nas fases 1–3 |
| Cache | Worker usa TTL positivo de 240 s, com possibilidade de servir resposta anterior; navegador mantem prefetch | Rever atualidade e custo na Fase 2 |
| Interno | 49 paradas e 13 variantes de linhas embutidas em HTML; JSON identico em backups/interno | Preservar trajetos, horarios, MIT |
| Mapas | Leaflet por CDN, fonte Google e imagens OSM | Hospedar biblioteca local e tratar falha de tiles na Fase 5 |
| Sorteios | GitHub Actions agendado quarta–sexta 18h10 BRT, gate de variavel e WIF; monitor 19h15 | Migrar somente na Fase 6, evitando duplicados |
| Festas | Firestore permite apenas escritas especificas de participantes/admin sob regras separadas | Nao prejudicar ao remover armazenamento de cardapios |
| QA | Existem outros agendamentos read-only em workflows ocupa-qa-* | Nao confundir com sincronizacao oficial do Hub |

O agendamento de sorteios exige HUB_PROD_RAFFLES_ENABLED=true; o estado real dessa variavel e dos segredos de producao nao foi inspecionado nesta auditoria.

## 3. Auditoria local sem rede

No PowerShell, na pasta do repositorio:

~~~powershell
Set-Location "D:\Downloads\Hub-UFMG"
git pull --ff-only origin main
npm run audit:phase0
npm test
~~~

A auditoria verifica oito contratos: origem/IDs/método fixos da FUMP, consulta sem escrita pelo visitante, regras Firestore negando escrita publica de cardapios, cron e gates de sorteio, monitor sem permissao de apuracao, ausencia de cron nos sincronizadores administrativos de cardapio, backup identico das rotas e navegacao canonica do Interno no Service Worker.

Os testes unitarios simulam adulteracoes para provar que o auditor falha quando um contrato e quebrado. Para conferir a interface, usar npm run test:e2e (Playwright instalado) ou a workflow Validar projeto.

Mudancas intencionais de arquitetura exigem atualizar os testes de seguranca **na mesma PR**, com justificativa; nao apagar os gates apenas para deixar CI verde.

## 4. Politica de implementacao e deploy

1. Uma PR por camada: FUMP/cardapios, Interno, sorteios, segurança, monitoramento.
2. Confirmar SHA e versao em producao antes de alterar sistemas.
3. Preservar separacao de dados: cardapios oficiais nao podem ser gravados por visitantes; inscricoes e sorteios continuam autenticados.
4. Testar FUMP com prato valido, vazio, falha HTTP, data divergente e mudanca de ultima hora.
5. Testar desktop, celular e PWA com SW antigo; manter Interno funcionando.
6. Nao habilitar cobranca, KV pago, novo executor ou permissao de producao sem plano separado.
7. Nenhum deploy ou operacao administrativa faz parte desta Fase 0.

## 5. Rollback sem reescrever a main

**Somente diante de incidente real, com autorizacao e apos confirmar que o problema e do Hosting.** Nunca usar git reset --hard sobre a main.

Preparar uma copia isolada do codigo anterior no Windows:

~~~powershell
& {
    $ErrorActionPreference = "Stop"
    $repo = "D:\Downloads\Hub-UFMG"
    $rollback = "D:\Downloads\Hub-UFMG-rollback-fase0"
    $base = "d36a593889bd011d89c4c199f0a90898e00cb48f"
    git -C $repo fetch origin
    if ($LASTEXITCODE -ne 0) { throw "FETCH_FALHOU" }
    if (Test-Path $rollback) { throw "PASTA_ROLLBACK_JA_EXISTE" }
    git -C $repo worktree add --detach $rollback $base
    if ($LASTEXITCODE -ne 0) { throw "WORKTREE_FALHOU" }
    if (-not ((Get-Content "$rollback\public\config.js" -Raw).Contains('firebaseProjectId: "hubufmg"'))) {
        throw "PROJETO_FIREBASE_INCORRETO"
    }
    Write-Host "Referencia pronta em $rollback; inspecione antes do deploy." -ForegroundColor Yellow
}
~~~

Se (e somente se) o rollback do **Hosting** tiver sido autorizado e a versao anterior for compativel:

~~~powershell
Set-Location "D:\Downloads\Hub-UFMG-rollback-fase0"
npx.cmd --yes firebase-tools@15.22.1 deploy --only hosting --project hubufmg --non-interactive
if ($LASTEXITCODE -ne 0) { throw "ROLLBACK_HOSTING_FALHOU" }
~~~

Este procedimento restaura SOMENTE Hosting. Nao altera Worker, Firestore, autenticaçao nem sorteios. Mudancas coordenadas de Worker e frontend exigem validar compatibilidade antes do rollback.

## 6. Saida da Fase 0

- [x] Commit inicial registrado e branch de referencia criada.
- [x] Inventario de pontos de falha e de persistencia legada.
- [x] Contratos de seguranca verificados sem acesso externo.
- [x] Rollback documentado sem alteracao da main.
- [ ] CI da PR desta fase aprovado e codigo integrado.
- [ ] Versao exata do site publicada confirmada em navegador externo (nao inferir do GitHub).
- [ ] Backup independente do proprio GitHub (Fase 8).

Proximo passo, apos a auditoria: Fase 1 — consultar somente a FUMP para cardapios, retirando fallback de Firestore/JSON e sem mudar o backend de festas.
