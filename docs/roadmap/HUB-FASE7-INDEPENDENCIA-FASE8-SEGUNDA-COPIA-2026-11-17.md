# Hub UFMG — independência do monitor e proteção de backup

Data: 17/11/2026. Incremento de continuidade após as Fases 6–8.

## Monitor independente de GitHub

O GitHub pode desativar workflows agendados de repositórios públicos após 60
dias sem atividade. A Fase 7 agora possui uma segunda origem de agendamento:
**Cloudflare Workers Cron Triggers**, no Worker de FUMP já existente.

- Um gatilho: `30 11,16,21 * * *` (UTC), equivalente a 08h30, 13h30 e
  18h30 de Brasília, diariamente. Não há dependência de GitHub Actions.
- **Cinco GETs por execução**, em paralelo: Service Worker público do
  Firebase Hosting e respostas oficiais da FUMP para os **quatro RUs (6, 1, 2, 5)**
  na data atual. O volume é limitado a 15 GETs por dia nos três horários.
  Resposta vazia continua sendo sucesso, não confirmação de fechamento.
- Resposta oficialmente vazia da FUMP é válida; erro HTTP, JSON inválido,
  data/restaurante divergente ou site indisponível são detectados. O relatório
  diferencia FUMP `OK`, `PARTIAL` (um ou mais RUs com falha) e `ERROR`
  (todos indisponíveis), registrando somente os IDs públicos e seus estados.
  Falhas parciais ou gerais marcam a execução como degradada.
- Não guarda cardápios, cookies, IDs de usuários, credenciais, resultados
  pessoais ou segredos. Não realiza sorteios nem escritas Firestore.
- Com falha, o `scheduled()` lança erro para que a invocação fique marcada
  como malsucedida no histórico de Cron Triggers. Os logs incluem apenas
  `hosting`, `fump`, `date` e `readOnly`.
- Trata-se de **vigilância passiva independente**: registro de falhas no
  painel Cloudflare, sem envio automático de email/WhatsApp. Não depende
  do GitHub para executar, mas ainda depende da Cloudflare. A ativação de
  alerta externo requer canal autorizado, sem segredos públicos.
- No Workers Free, Cloudflare declara até cinco Cron Triggers por conta e
  100 mil invocações/dia. Esta solução usa **um** Trigger, três execuções
  diárias, fora do horário exato do sincronismo GitHub.
- A publicação do Worker atualiza também os gatilhos declarados em
  `worker/wrangler.toml`. Antes de publicar, confirmar que não há outro Cron
  Trigger configurado manualmente no mesmo Worker; Wrangler gerencia a lista.

Referências:
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/platform/limits/

## Backup secundário de código — opt-in

`scripts/HUB-BACKUP-GIT-LOCAL.ps1` agora aceita
`-DestinoSecundario "X:\Hub-UFMG-Backups"`, usando um segundo caminho
absoluto previamente escolhido e acessível. Serve para unidade USB,
compartilhamento de rede ou pasta de sincronização autorizada. Ele:

1. Cria o Git bundle completo com histórico e checksum SHA-256 no caminho
   primário e testa um clone real em diretório temporário.
2. Se houver destino secundário, copia **bundle e manifesto** sem sobrescrever
   arquivo anterior.
3. Confere SHA-256 da cópia e também executa um clone real da cópia.
4. Se a cópia estiver no mesmo volume, avisa que não há isolamento físico.

O backup não é periódico e não é necessário para a publicação normal:
o código já está versionado no GitHub. O operador pode executá-lo diretamente
quando houver necessidade de uma cópia fora do repositório. Durante o deploy,
ele só roda com `HUB_BACKUP_BEFORE_DEPLOY=true`; se uma segunda pasta for
desejada, indicar `HUB_BACKUP_SECONDARY_PATH`. Nenhuma dessas opções
está habilitada por padrão.

**Limites importantes:** backup Git não inclui documentos Firestore,
dados pessoais, chaves privadas ou configuração de conta Cloudflare.
Backup gerenciado do Firestore exige faturamento; portanto não faz parte
do plano gratuito atual. Backup privado seguro e recuperação do Firestore
seguem como etapa posterior, a ser tratada sem publicar dados sensíveis.

## PWA e fonte única

- Leaflet JS/CSS 1.9.4 passam a integrar os recursos **CORE** da
  instalação do Service Worker, e não apenas a lista best-effort.
  Assim, o modo offline com linhas e 49 paradas não fica dependente de
  uma falha de download opcional.
- O arquivo legado `public/data/cardapios.json` permanece no Git,
  como histórico, mas foi colocado na lista `hosting.ignore`:
  **não será publicado pelo Firebase Hosting na próxima implantação**.
  Nenhum visitante grava conteúdos de cardápio. A FUMP continua sendo
  a fonte operacional exclusiva.

## Publicação unificada, SEM deploy agora

O script preparado é `scripts/HUB-BATCH-DEPLOY-VERIFICAR.ps1` (PowerShell 5.1).
Depois que todos os lotes estiverem aprovados, ele fará em uma execução:

1. Atualizar `main` e, somente quando solicitado explicitamente,
   criar snapshot Git com restauração de teste.
2. Auditar as regras locais de segurança.
3. Publicar o Cloudflare Worker **e o Cron**.
4. Verificar em HTTPS que o Worker bloqueia IDs arbitrários (400), retorna
   CORS adequado e não permite cache de erros, independentemente da saúde
   da FUMP naquele momento.
5. Publicar o Firebase Hosting **e** as Firestore Rules e confirmar versão
   pública v277, app atualizado e Leaflet local.

O script não ativa o executor de sorteios nem modifica o gatilho
`HUB_PROD_RAFFLES_ENABLED`. O Worker Cron não participa de sorteios.

## Critério de conclusão

Testes unitários e E2E precisam ficar verdes antes do merge. A existência de
código no GitHub não prova que o Cron esteja executando na Cloudflare nem
que a v277 esteja publicada. Após deploy, verificar o histórico de Cron
Triggers no painel Cloudflare e o conteúdo de Hosting. O requisito de
autonomia permanente continua limitado por disponibilidade, cota gratuita
e mudanças de políticas dos provedores.

## Decisão de escopo: sem backup semanal

O agendamento semanal do Windows foi descartado. Não resolve o risco principal
do site (perda de inscrições/resultados do Firestore) e duplica um histórico
que já existe no GitHub. Não há tarefa programada no projeto.

Permanecem apenas o versionamento GitHub, o backup dos dados públicos próprios
do Interno já incluído no repositório e uma ferramenta manual de snapshot Git
para uso excepcional. Uma eventual recuperação de dados de participantes
precisará de um projeto específico, privado e proporcional ao risco.
