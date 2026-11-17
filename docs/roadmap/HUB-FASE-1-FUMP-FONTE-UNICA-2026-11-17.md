# Hub UFMG — Fase 1: cardápios oficiais como única fonte operacional

Data: 17/11/2026. Escopo: `public/assets/app.js`, configuração do frontend,
Service Worker, testes de regressão e documentação. **Não altera o Cloudflare Worker
nem o estado do Firestore e não desativa funcionalidades de festas/sorteios.**

## Política de exibição

1. Os pratos na tela vêm apenas da resposta da FUMP consultada pelo Worker
   (ou da API oficial diretamente no cliente, quando o proxy não está configurado).
2. O aplicativo não lê mais `publicMenus/current`, `publicFeedUrl` nem
   `/data/cardapios.json` como substitutos. O arquivo legado continua no
   repositório, mas deixa de ser lido e pré-armazenado no PWA.
3. A preferência do RU e os metadados de controle de pré-consulta permanecem
   em `localStorage`, sem pratos; os dois índices antigos de cardápios
   (`ruhoje:menus:v1` e `ruhoje:live-menus:v1`) são descartados no boot.
4. Cardápios consultados durante a sessão ficam em memória, respeitando
   a origem, data e consistência do payload validado.
5. Se a FUMP mudar o conteúdo e retornar outro menu válido, o menu na tela
   é substituído. Uma resposta oficialmente vazia, data inválida ou erro
   não deve manter os pratos da consulta anterior como se fossem atuais.
6. Respostas marcadas `CF-Cache-Status: STALE` são rejeitadas para exibição
   como menu atual (e o usuário recebe indisponibilidade). O TTL positivo
   existente do Worker ainda é 240 segundos — sua revisão é Fase 2.
7. O estado sem pratos **não significa RU fechado**. Desde a versão v275,
   as bolinhas do calendário identificam **somente dias sem atendimento regular
   previsto** para o RU selecionado, sem depender da existência de cardápio.
   Sábados sem funcionamento regular: Setorial II e Direito; domingos: todos.
   Horários excepcionais e feriados não são inferidos automaticamente.
8. O PWA continua armazenando arquivos de aplicativo e dados estáticos do
   Interno; nenhum backup de itinerários foi apagado.

## O que fica intacto

- Regras Firestore de festas, inscrições e apuração.
- Workflow privado de sorteios e seu monitoramento.
- Cloudflare Worker, contratos de proxy e credenciais.
- Itinerários, mapa e marcador unificado de 49 paradas do Interno.
- Catálogo auxiliar de ingredientes (arquivo estático; não decide quais pratos
  serão servidos pela FUMP).

## Testes de aceitação

```powershell
Set-Location "D:\Downloads\Hub-UFMG"
npm run audit:phase0
npm test
npm run test:e2e
```

Além dos testes unitários, o E2E simula a API oficial com cardápios válidos,
substituição por novos pratos, erro 503 após prato válido, Firestore com
pratos legados e `localStorage` adulterado/antigo; o navegador não deve mostrar
o conteúdo legado nem fazer leitura de `publicMenus/current`. Confere também
pré-carregamento D+1, PWA com Service Worker e módulo Interno.

## Publicação e validação (Hosting SOMENTE, após aprovação)

O código deve passar no CI e ser integrado à `main`. Depois, no computador
com Firebase CLI autenticado:

```powershell
& {
  $ErrorActionPreference = "Stop"
  Set-Location "D:\Downloads\Hub-UFMG"
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { throw "GIT_PULL_FALHOU" }
  npx.cmd --yes firebase-tools@15.22.1 deploy --only hosting --project hubufmg --non-interactive
  if ($LASTEXITCODE -ne 0) { throw "DEPLOY_FALHOU" }

  $nonce=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $sw=(curl.exe -fsSL "https://hubufmg.web.app/service-worker.js?v=$nonce") -join "`n"
  if($LASTEXITCODE -ne 0 -or -not $sw.Contains("hub-v274-20261117-fump-only-r1")){throw "SW_DESATUALIZADO"}
  $app=(curl.exe -fsSL "https://hubufmg.web.app/assets/app.js?v=$nonce") -join "`n"
  if($LASTEXITCODE -ne 0 -or $app.Contains("publicMenus/current") -or
     $app.Contains("/data/cardapios.json") -or
     -not $app.Contains("function menuFor(date, ruId) { return liveMenuFor(date,ruId); }")){throw "CLIENTE_NAO_ATUALIZADO"}
  Write-Host "HUB_FASE1_PUBLICADA_E_VALIDADA" -ForegroundColor Green
}
```

Este deploy não inclui regras de Firestore nem Worker.
Antes do deploy, comparar o Hosting ativo com a versão no repositório; a integração
da PR **não publica o site automaticamente**.

## Limites e próximas fases

- O cache da Cloudflare ainda pode servir até 240 s de resposta oficial; o
  navegador pode reutilizar uma consulta recente por até 4 minutos. A atualização
  explícita e os TTLs serão revisados na **Fase 2**.
- Os controles de pré-carregamento ainda são salvos como metadados locais,
  sem conteúdos de pratos; a limpeza da persistência desnecessária prossegue na
  **Fase 3**, sem desativar preferências legítimas.
- O documento Firestore legado continua protegido por Rules sem escrita de
  cliente, mas ainda existe para referência/recuperação administrativa. Apagá-lo
  ou tornar Rules mais restritivas exige auditoria e autorização separadas.
- Atualização da FUMP não é garantida em tempo real absoluto: depende da publicação
  da própria FUMP e do TTL. **Nenhuma cópia antiga é considerada fonte alternativa.**

Rollback: procedimento documentado em
`docs/roadmap/HUB-FASE-0-AUDITORIA-BASELINE-2026-11-17.md`.
