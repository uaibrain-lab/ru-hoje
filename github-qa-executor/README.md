# Bandeco — executor de sorteios QA

Repositório mínimo e privado para executar apurações automáticas exclusivamente no projeto Firebase `bandeco-homologacao`.

## Limites de segurança

- Não contém frontend, dados de participantes, credenciais ou chave privada.
- Rejeita qualquer projeto que não seja `bandeco-homologacao`.
- Aceita somente ADC temporário do GitHub OIDC/Google Workload Identity Federation.
- A conta permitida é `bandeco-qa-runner@bandeco-homologacao.iam.gserviceaccount.com`.
- A publicação usa transação Firestore, é idempotente e não substitui resultados existentes.
- O workflow não recebe segredos em pull requests e só executa no branch `main`.

## Configuração remota

Variáveis do repositório:

- `RU_FESTAS_QA_DRAW_ENABLED=true`
- `BANDECO_QA_WORKLOAD_IDENTITY_PROVIDER=projects/342397522942/locations/global/workloadIdentityPools/.../providers/...`
- `BANDECO_QA_SERVICE_ACCOUNT=bandeco-qa-runner@bandeco-homologacao.iam.gserviceaccount.com`

Segredo criptografado do repositório:

- `BANDECO_QA_PRIVATE_KEY_JWK`: chave RSA privada exclusiva de QA, nunca impressa nem versionada.

## Agendamento e custo

O cron está configurado para executar diariamente às 18:10 no fuso `America/Sao_Paulo`. Isso representa no máximo 31 execuções em um mês de 31 dias, antes de execuções manuais. O GitHub não garante início exato; a apuração ocorre na primeira execução efetiva após o prazo.

## Desligamento emergencial

Defina `RU_FESTAS_QA_DRAW_ENABLED=false` ou desabilite o workflow no GitHub Actions. A remoção do vínculo `roles/iam.workloadIdentityUser` da conta QA revoga a autenticação federada.
