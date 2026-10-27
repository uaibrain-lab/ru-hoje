# P5-G1 — Agendador QA

## Estado

O workflow read-only (`.github/workflows/ocupa-qa-cardapios-schedule.yml`) contém `workflow_dispatch` e quatro janelas `schedule`. A coleta continua sem autenticação de escrita e o job WIF separado só roda em evento `schedule`; não há `apply`, publicação, role de dados, secret ou backup remoto.

## Matriz proposta

| Dias | Execução local proposta | Finalidade |
|---|---:|---|
| segunda a sexta | 05:40 | antes do café do Setorial I |
| segunda a sexta | 09:30 | antes do almoço dos Setoriais I e II |
| segunda a sexta | 16:10 | antes do jantar do Setorial II |
| sábado | 10:00 | antes do almoço do Setorial I |
| domingo | nenhuma | não publicar por ausência de serviço regular |

Timezone: `America/Sao_Paulo`. O GitHub Actions pode atrasar ou perder execuções agendadas; os horários não são garantia de pontualidade.

Fontes oficiais consultadas:

- https://vet.ufmg.br/fique-de-olho-avisos/nova-data-para-o-cafe-da-manha-e-jantar-mudarem-de-restaurante-no-campus-pampulha/
- https://www.ufmg.br/comunicacao/noticias/servicos/restaurante-setorial-ii-vai-ampliar-capacidade-de-atendimento-no-almoco/

## Identidade P5-G2-A

Pool: `ocupa-qa-scheduler`.

Provider: `ocupa-qa-cardapios-schedule`.

Conta: `ocupa-qa-cardapios-scheduler@bandeco-homologacao.iam.gserviceaccount.com`.

A conta scheduler deve ter somente `roles/iam.workloadIdentityUser` no próprio recurso da conta, com condição pelo ID imutável do repositório, owner, branch, workflow exato e evento `schedule`. Ela não recebe permissões Firestore.

## Ativação futura P5-G2-B

1. Criar `ocupa-qa-scheduler`, provider `ocupa-qa-cardapios-schedule` e a conta de serviço correspondente, com condições pelo ID imutável do repositório, owner, `refs/heads/main`, workflow exato e evento `schedule`.
2. Iniciar sem papéis Firestore.
3. Adicionar `schedule` somente em uma alteração aprovada, primeiro com coleta/dry-run read-only.
4. Comprovar uma execução real disparada por `schedule`, incluindo identidade e ausência de escrita.
5. Somente após aprovação específica, conceder a role mínima já existente e habilitar publicação QA.
6. Nunca reutilizar o provider manual nem permitir fallback para produção.

Não repetir automaticamente uma escrita cujo resultado seja incerto. Após falha posterior a uma possível escrita, consultar o documento QA por leitura e encerrar a rodada.
