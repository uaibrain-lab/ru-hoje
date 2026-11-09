# Hub UFMG — Atualização automática dos cardápios (produção)

## Objetivo
O site público deixa de oferecer o botão de atualização manual. A publicação de novos cardápios é exclusivamente feita por workflows autorizados do GitHub Actions, utilizando a API oficial da FUMP e Firestore do projeto `hubufmg`.

## Agendamentos — horário de Brasília (UTC−3)
| Dias | Principal | Redundante |
| --- | --- | --- |
| Segunda a sexta | 05h41, 09h41, 13h41, 17h41 | 07h23, 11h23, 15h23, 19h23 |
| Sábado | 10h41, 15h41 | 12h23, 17h23 |
| Domingo | 13h41 | 16h23 |

Os workflows usam identidades de serviço separadas, sem chaves JSON:
- Principal: `.github/workflows/hub-production-cardapios.yml`, `hub-prod-sync@hubufmg.iam.gserviceaccount.com`.
- Redundante: `.github/workflows/hub-production-request-processor.yml`, `hub-prod-refresh@hubufmg.iam.gserviceaccount.com`. O nome interno do arquivo foi preservado para não mudar uma eventual condição de confiança do Google WIF.
- Ambos possuem `concurrency.group: hub-production-menu-writer`, `cancel-in-progress: false`.

Cada execução de sincronização:
1. Exige `HUB_PROD_SYNC_ENABLED=true` e `HUB_PROD_PUBLISH_ENABLED=true`.
2. Autentica na identidade Google federada, exclusiva do projeto `hubufmg`.
3. Coleta até sete datas e valida restaurantes, tipos e estrutura de dados.
4. Em modo apply, passa a confirmação `--confirm=PUBLICAR_SOMENTE_HUB_UFMG`.
5. Repete até três tentativas em falhas, com pequenos intervalos; não publica dados inválidos.
6. Evita publicar snapshots idênticos e verifica a escrita quando há alteração.

## Detecção e reação a falhas
- Em caso de falha no workflow principal ou redundante, é criado ou atualizado um **Issue público do GitHub com link para a execução**, sem expor credenciais nem dados privados.
- Após o retorno ao sucesso, o Issue correspondente é fechado automaticamente.
- O watchdog `.github/workflows/hub-production-watchdog.yml` verifica os agendamentos nos dias e horários de operação. Se não encontrar execução **agendada** bem-sucedida nas últimas cinco horas, registra alerta e tenta acionar um `workflow_dispatch` de `apply` no principal.
- Se as variáveis de autorização estiverem desligadas, o watchdog avisa e não as contorna.
- A execução manual de administrador continua disponível no GitHub, por segurança, com `dry-run` como padrão; **não existe mais botão de solicitação no site**.

## Limites reais
O GitHub documenta que execuções `schedule` podem sofrer atraso, ser descartadas em alta carga ou ficar desativadas após 60 dias sem atividade num repositório público. A duplicação e o watchdog reduzem riscos, mas **não oferecem uma garantia matemática de execução pontual**, porque continuam dependentes do mesmo provedor. Um monitor externo independente e um segundo serviço de agendamento seriam necessários para tolerar indisponibilidade total do GitHub.

## Antes da publicação
1. Revisar a PR e executar a suíte unitária, E2E e testes simulados da rotina.
2. Confirmar as duas variáveis de autorização de produção e identidades WIF no GitHub.
3. Integrar a branch na `main` após aprovação.
4. Publicar **Hosting e Firestore Rules** no projeto correto `hubufmg`, porque o código remove o botão e as Rules bloqueiam pedidos legados.
5. Conferir a versão publicada do service worker `hub-v263-20261109-scheduled-only-r1`.
6. Acompanhar execuções reais dos dois agendamentos e do watchdog no GitHub após o merge.

Nunca empregar o projeto Firebase QA, chaves JSON ou execução de publicação a partir de uma pasta local não verificada.
