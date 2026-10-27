# Procedimento proposto para P5-F2

Este documento é preparatório. Nenhuma etapa abaixo foi executada na P5-F1.

1. Revisar o workflow, o provider WIF e a role mínima.
2. Criar, somente no projeto `bandeco-homologacao`, o pool exclusivo `ocupa-qa-publisher`, o provider `ocupa-qa-cardapios-publish` e a conta `ocupa-qa-cardapios-publisher@bandeco-homologacao.iam.gserviceaccount.com`.
3. Criar a role customizada somente após confirmar os métodos realmente usados. A role não limita por documento; o código continua responsável por fixar `publicMenus/current`.
4. Conceder à conta publisher apenas a role aprovada e o binding WIF do workflow exato.
5. Aguardar propagação IAM e provar autenticação sem Firestore.
6. Criar snapshot privado do documento QA fora do repositório público, com ACL restrita.
7. Executar coleta nova e dry-run. Não usar `--mode=apply` ainda.
8. Revisar contagens, dois almoços setoriais, frescor, payload e diferença real.
9. Somente com autorização específica, executar uma única publicação manual QA.
10. Conferir Admin SDK e leitura pública, registrar backup, hashes e rollback.
11. Manter cron desativado até homologação posterior.

Nunca usar `cardapioufmg`, chave JSON, segredo de service account ou credencial de produção. Não publicar o snapshot como artefato público.
