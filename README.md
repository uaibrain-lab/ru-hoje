# RU Hoje v1.2 — preparo seguro para GitHub + Firebase Spark

Projeto independente do UaiBrain. Principal uso: smartphones. Interface PWA, cache offline e favorita o último RU usado.

## Estado comprovado

- `npm test`: 9/9 testes de parser e mesclagem aprovados neste ambiente.
- `node --check`: JS da aplicação, script de teste, verificação e publicação sem erros de sintaxe.
- **`npm run test:e2e` precisa ser reexecutado no computador do usuário**. A versão v1.2 corrige um provável bloqueio CORS na simulação Firestore da v1.1 e isola o service worker do teste E2E. Não confundir esta correção com E2E aprovado.
- **Coleta real da FUMP ainda não validada**; é obrigatório conferir dados de RU, data, almoço/jantar e nomes dos pratos antes de ativar a publicação automática.
- Não há deploy no pacote ou no GitHub Actions.

## Integração de projetos

- GitHub: repositório vazio chamado `ru-hoje`, com proprietário a identificar através de `gh repo list`.
- Firebase: projeto informado como `cardapioufmg`. Confira que esse é o **ID exato** do projeto no console; ele já está configurado em `public/config.js` e como trava de segurança nos scripts `check-config.mjs` e `publish.mjs`.
- Firestore Standard: banco `(default)`, no plano Spark. O aplicativo lê exclusivamente `publicMenus/current` via Firestore REST; o workflow grava via Admin SDK usando o secret `FIREBASE_SERVICE_ACCOUNT_JSON` somente depois da aprovação do piloto.
- Hospedagem: Firebase Hosting clássico, pasta `public`.

## Primeira execução: sem publicar nada

1. Instale Node 20+, `npm install --no-audit --no-fund`, `npx playwright install chromium`.
2. Rode `npm test` e `npm run test:e2e`; os dois precisam passar antes de sincronizar repositório.
3. Faça upload do código para o GitHub, preservando `.github/workflows` e sem inserir segredos nem pratos sintéticos.
4. No Actions, execute manualmente `Sincronizar cardápios FUMP` com `days=1` e `publish=false`.
5. Examine os logs e o artifact `diagnostico-fump`; confronte com o site oficial.
6. Corrija qualquer problema de extração e repita o teste real. Não ative publicação com dados incompletos ou trocados.
7. Somente após validar uma coleta real, criar/configurar Firestore, regras, conta de serviço exclusiva e secret, e ativar publicação com aprovação específica.

## Coleta e agendamento

O cron roda segunda–sábado às 07h23, 12h23, 14h43, 16h23 (Brasília; execução pode atrasar). O modo padrão **apenas coleta para diagnóstico, sem publicação**. Para um despacho manual, use `workflow_dispatch` com `publish=false` e `days=1`.

A variável de repositório `RU_SYNC_PUBLISH_ENABLED=true` habilita publicação nos agendamentos. Enquanto ausente/falsa, agendamentos continuam em modo diagnóstico. Nunca habilitar essa variável antes da comparação manual com a fonte e testes de leitura pública autorizada.

Para publicação manual pontual, use `publish=true` somente depois de instalar o secret correto, garantir banco e regras preparados e ter uma captura conferida. A conta de serviço precisa ter privilégios mínimos no projeto `cardapioufmg`. Nunca enviar seu JSON secreto em chat, código, screenshots ou commits.

## Compatibilidade Spark e dados de produção

Somente Hosting clássico e Firestore Standard; nada de Blaze, Cloud Functions, Cloud Scheduler, App Hosting ou Cloud Run. GitHub Actions executa fora do Firebase, observando cotas da conta GitHub. Dados oficiais podem ser atualizados várias vezes por dia e o app exibe o aviso oficial da FUMP e informa última consulta.

`public/data/cardapios.json` deve continuar vazio no Git até a publicação ser ativada. A coleta local sobrescreve esse arquivo; restaure o conteúdo vazio antes de commit. `diagnostics/` está no `.gitignore`.

## Segurança e diagnóstico

Regras: `firestore.rules` permite apenas leitura de `publicMenus/current` por clientes; escrita exige Admin SDK/IAM. `firebase deploy` **não** aparece em nenhum workflow. As regras do Firestore precisam ser publicadas somente com autorização explícita para a operação. A publicação do Hosting é uma operação diferente e também exige autorização.

Testes úteis:

```powershell
npm install --no-audit --no-fund
npx playwright install chromium
npm test
npm run test:e2e
node --check public/assets/app.js
node --check scripts/smoke.mjs
npm run scrape -- --days 1
```

O último comando é uma coleta externa real, que não publica no Firebase. Se falhar, ver `diagnostics/summary.json`, `diagnostics/last-run.json` e screenshot `diagnostics/fump.png`. Não inventar pratos para contornar falhas.
