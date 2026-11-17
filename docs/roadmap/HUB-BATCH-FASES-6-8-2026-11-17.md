# Hub UFMG — Lote Fases 6, 7 e 8 (17/11/2026)

**Escopo:** reforço transacional dos sorteios; auditoria automática somente leitura;
verificação real de restauração do backup local. **Nenhuma migração/ativação
de executor de sorteios e nenhum deploy Firebase/Cloudflare neste lote.**

## Fase 6 — Sorteios: impedir duplicidades e resultados inconsistentes

O executor existente é `hub-production-raffles.yml`, com disparo agendado
**somente quarta a sexta às 18h10 em Brasília**, e operação privada WIF de
`hub-prod-raffles@hubufmg.iam.gserviceaccount.com`.

- `scripts/raffle-publication-guard.mjs` valida o snapshot exato de inscritos
  **dentro de uma transação do Firestore**, depois da descriptografia CSPRNG.
  A mesma contagem de participantes não é suficiente: qualquer alteração do
  documento de inscrição, UID, campos de premiação, horário de encerramento ou
  estado do evento invalida a publicação.
- Todas as leituras transacionais (evento, resultado público, privado e query
  de inscrições) ocorrem antes das três escritas atômicas. Se houver falha ou
  retry, nenhum conjunto parcial de resultados é publicado.
- Publicação anterior completa retorna resultado idempotente, sem segundo
  sorteio. Resultado **parcial já existente** gera erro em vez de tentar
  substituí-lo silenciosamente.
- Nenhum nome completo, ciphertext ou chave é gravado no log. Os hashes de
  inscrições continuam disponíveis como comprovação do conjunto sorteado.
- Os testes simulam edição com mesmo número de inscritos, alteração de prazo,
  prêmio, visibilidade, dados privados e resultado preexistente.
- O gate `HUB_PROD_RAFFLES_ENABLED` e a janela agendada não foram alterados.
  A configuração estática ainda tem `enabled:false`; a variável real
  de Actions requer auditoria autenticada separada. Não ativamos sorteios.
- A verificação transacional adicional custa leituras extras de Firestore
  durante cada sorteio. Para preservar o plano gratuito, é necessário verificar
  a quantidade de inscritos e os limites atuais antes de habilitar eventos
  com grande público. O GitHub Actions pode atrasar ou não executar o cron;
  não oferece garantia de pontualidade absoluta.

### Monitor de execução sem falsos alertas

- `scripts/raffle-monitor-policy.mjs` analisa apenas metadados de workflows.
- Quando o gate está desligado, nenhum sorteio é esperado e não há incidente.
- Quando ligado, só aceita execução `schedule` na branch `main` com sucesso
  recente; ignora disparo manual, branch diferente, erro e execução antiga.
- Monitora às 19h15 e 19h45 de quarta a sexta. Isso NÃO acrescenta sorteios
  nem expõe chave WIF ao monitor. A segunda checagem trata atrasos.
- Se não houver execução bem-sucedida quando deveria haver, abre/atualiza
  incidente deduplicado no GitHub; uma execução posterior bem-sucedida o fecha.
- O monitor verifica execução do workflow, **não prova que havia sorteios
  elegíveis nem que cada evento foi sorteado**. Essa reconciliação exige
  acesso somente leitura autenticado e homologação adicional.

## Fase 7 — Saúde do Hub com vigilância de baixo custo

- A `hub-live-readonly-probe.yml` consulta Hosting, app, PWA, Interno e
  os quatro IDs oficiais da FUMP via Worker às 07h30, 12h30 e 17h30 de
  segunda a sábado, além de permitir disparo manual/PR.
- Classifica `HOSTING_DOWN`, `PROXY_OUTAGE`, `PARTIAL_UPSTREAM`, `OK`.
- Alerta de incidente GitHub apenas diante de Hosting indisponível ou
  falha generalizada de API. Falha isolada é apenas sinalização, sem gravar
  pratos ou forçar uma fonte alternativa.
- Não usa segredos, login ou permissão Firestore. `issues: write` serve
  somente para alertas internos no repositório.
- A execução é melhor esforço do GitHub Actions; monitoração independente
  fora do GitHub não está concluída.

## Fase 8 — Backup verificável com ensaio de restauração

- O backup de código usa `git bundle create --all` com SHA-256 local.
- Novo verificador `scripts/verify-hub-bundle.mjs` valida SHA-256 e nome,
  cria um **repositório Git temporário vazio** para `git bundle verify`,
  clona o bundle em outro diretório temporário e consulta arquivos
  fundamentais (Interno, app, regras) do commit recuperado.
- Mesmo que o bundle exista, o script falha se estiver corrompido,
  incompleto ou não puder ser clonado. O diretório temporário é removido.
- O backup local continua sem dados privados do Firestore, segredos ou
  configurações externas; somente código e histórico. A segunda mídia e
  exportação criptografada de dados administrativos permanecem pendentes.
  **Não suba arquivos privados para o repositório público.**

## Testes e publicação

```powershell
Set-Location "D:\Downloads\Hub-UFMG"
npm test
npm run test:e2e
npm run audit:phase0
```

Mudanças de workflow e backend serão carregadas automaticamente pelo GitHub
**após o merge na `main`**, mas **sem ativar o gate de sorteio**. O deploy
consolidado de Hosting+Firestore Rules da v277 (Fases 3–5) ainda está pendente
e continua preparado em `scripts/HUB-BATCH-DEPLOY-VERIFICAR.ps1`.
Nenhum novo deploy Hosting ou Cloudflare é exigido pelas mudanças deste lote;
uma publicação Firebase reunirá o código cliente pendente quando autorizado.

**Limites:** autonomia absoluta/gratuidade perpétua não podem ser prometidas,
pois FUMP, Firebase, Cloudflare, GitHub e OSM permanecem serviços externos.
Fase 6 continua parcialmente concluída até validar o gate real, QA end-to-end
de credenciais e comportamento de sorteios elegíveis em ambiente de teste.
