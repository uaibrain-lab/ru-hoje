# Contrato do publicador QA

- Projeto fixo: `bandeco-homologacao`.
- Documento fixo: `publicMenus/current`.
- Fonte: domínio oficial FUMP.
- Modo padrão: `publish=false`, somente leitura/dry-run.
- Publicação: exige `publish=true`, `confirm=true`, flags QA e ACK explícito.
- Atualização: uma única operação no documento existente, protegida por `lastUpdateTime`.
- Criação e exclusão: não permitidas pelo sincronizador.
- Backup: obrigatório fora do projeto antes da escrita.
- Verificação: leitura Admin SDK e leitura pública após a escrita.
- Cron: inexistente nesta preparação.
- IAM: provider publisher será separado no pool `ocupa-qa-publisher`; a conta e o binding só devem ser criados na P5-F2A.

O workflow não altera Rules, Auth, IAM, Hosting ou o executor de sorteios.
