# Hub UFMG — Fase 2: atualização rápida e cache limitado

Data: 17/11/2026 · Projeto Firebase: `hubufmg` · Worker Cloudflare: `hub-fump-proxy`

## Regra de funcionamento

A FUMP continua como **única fonte de cardápios**. O site consulta por HTTPS o
Cloudflare Worker read-only, que valida RU e data antes de encaminhar a requisição
à FUMP. Não há gravação de cardápios por visitantes ou publicação manual.

A Fase 2 reduz a reutilização das respostas oficiais:

| Camada | Antes | Fase 2 |
| --- | --- | --- |
| Worker — cardápio com registro de refeições | 240 s | **60 s** |
| Worker — resposta vazia | 30 s | **15 s** |
| Worker — `stale-if-error` | até 1.800 s | **desativado** |
| Worker — HIT antigo ou sem timestamp | podia passar | **invalidado e reconsultado** |
| HTTP cache do navegador | `default` (reutilização adicional) | **`no-store`**; sem segunda camada |
| Atualização regular do RU/data selecionados | intervalo 240 s | **60 s** |
| Clique em data/RU ainda sem menu | podia repetir imediatamente | intervalo mínimo **30 s** |
| Cardápio em memória do visitante | sem idade máxima | **70 s** desde coleta oficial (60 s + margem de 10 s) |

Nenhum HIT pode reiniciar o tempo de validade: o Worker preserva a hora da coleta
original via `X-Menu-Fetched-At` e devolve somente o TTL restante. A UI recusa
timestamps ausentes, inválidos, muito antigos ou de relógio muito à frente, além
de respostas com `CF-Cache-Status: STALE`. Uma falha da FUMP não restitui
cardápios antigos; a tela mostra a indisponibilidade.

A biblioteca de pré-carregamento continua limitada a **12 consultas em segundo
plano por dispositivo/dia**, respeitando rede, visibilidade e intervalos. Pré-busca
não altera a fonte oficial; ao voltar para uma data com dado vencido, o navegador
consulta novamente a origem.

## Bolinhas do calendário

A mudança da versão **v275** foi preservada na v276: **somente datas sem
atendimento regular previsto têm a bolinha**, independentemente de cardápio.
Setorial I, Saúde e ICA atendem em sábados conforme os horários regulares; Setorial
II e Direito não. Domingo é sem atendimento regular em todos os RUs. Exceções
oficiais/feriados exigem informação distinta e não são inferidos da falta de
pratos. A bolinha não é indicador de ausência de dados.

## Segurança e independência

- Sem alterações nas Firestore Rules, Cloudflare KV, fontes externas arbitrárias,
  identidade de usuários ou endpoints de escrita.
- Workflows de sorteio, festas, Interno e login não foram modificados.
- Worker aceita `GET` apenas para os quatro IDs cadastrados e janela de data
  configurada; mantém proteção CORS para `hubufmg.web.app` e
  `hubufmg.firebaseapp.com`.
- Os dois níveis de cache remanescentes são **memória de sessão** e **Worker**;
  `localStorage` não salva pratos. Não existe fallback persistente para cardápios.
- Cloudflare Workers Free mantém limites diários de requisições. Aumentar
  frequência exige observar consumo real; este roadmap não promete atualização
  instantânea ou disponibilidade absoluta.

## Testes

Os testes unitários verificam cache HIT com TTL restante, MISS por expiração,
bloqueio de cache sem timestamp, erro da FUMP após expiração, payload vazio,
CORS, ID/date allowlist e resposta STALE rejeitada. E2E simula cardápio da FUMP
que muda ou fica 503, PWA instalado, pré-busca e calendário por RU.

```powershell
Set-Location "D:\Downloads\Hub-UFMG"
npm run audit:phase0
npm test
npm run test:e2e
```

## Publicação — ordem obrigatória

**A implementação no GitHub não publica automaticamente o Worker nem Hosting.**
Depois de CI aprovado e merge na `main`, é necessário executar, em sessão
autenticada do Windows PowerShell:

```powershell
& {
  $ErrorActionPreference = "Stop"
  Set-Location "D:\Downloads\Hub-UFMG"

  git pull --ff-only origin main
  if($LASTEXITCODE -ne 0){throw "GIT_PULL_FALHOU"}

  # Primeiro a origem: permite ao frontend cobrar timestamps oficiais de 60 s.
  npx.cmd --yes wrangler deploy --config worker/wrangler.toml
  if($LASTEXITCODE -ne 0){throw "WORKER_DEPLOY_FALHOU"}

  # Depois a interface/PWA v276.
  npx.cmd --yes firebase-tools@15.22.1 deploy --only hosting --project hubufmg --non-interactive
  if($LASTEXITCODE -ne 0){throw "HOSTING_DEPLOY_FALHOU"}

  $nonce=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $base="https://hubufmg.web.app"
  $sw=(curl.exe -fsSL "$base/service-worker.js?v=$nonce") -join "`n"
  if($LASTEXITCODE -ne 0 -or -not $sw.Contains('hub-v276-20261117-fresh-menus-r1')){throw "PWA_NAO_PUBLICADO"}
  $app=(curl.exe -fsSL "$base/assets/app.js?v=$nonce") -join "`n"
  if($LASTEXITCODE -ne 0 -or -not $app.Contains('const minimumGapMs=force')){throw "APP_NAO_PUBLICADO"}
  Write-Host "HUB_FASE2_V276_PUBLICADO" -ForegroundColor Green
}
```

## Pós-publicação

1. Abrir o Hub e selecionar RU e data atuais; cardápio só deve aparecer se a
   FUMP publicar pratos válidos. Confirmar via DevTools que a resposta tem
   `X-Menu-Fetched-At`, `Cache-Control` positivo de no máximo 60 s (ou 15 s
   vazio), e nenhum `stale-if-error`.
2. Repetir consulta ao RU/data após pelo menos um minuto e verificar que o
   instante da coleta mudou; resposta com mesmo prato pode ser legítima.
3. Em dia sem cardápio, bolinha só deve aparecer quando o RU não funciona.
4. Em erro 503, cardápio antigo não aparece como resultado atual.
5. Validar em rede diferente, porque alcance regional da API FUMP é externo.

## Rollback e dependências

Referência pré-roadmap em
`docs/roadmap/HUB-FASE-0-AUDITORIA-BASELINE-2026-11-17.md`.
Se houver incidente, avaliar o retorno coordenado de **Worker e Hosting**,
não reverter apenas o frontend novo sobre o Worker antigo sem testar o contrato
`X-Menu-Fetched-At`.

Próxima etapa: **Fase 3 — limpeza de persistência residual e pré-buscas**, sem
remover preferência do usuário, registros de sorteios ou dados do Interno.
