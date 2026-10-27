# Bandeco Festas — v2.6.0-RC1 — Correções aplicadas

**Base:** ZIP completo v2.5.9 enviado em 23/10/2026. **Destino exclusivo:** projeto `bandeco-homologacao` (QA). **Produção:** `cardapioufmg` não foi acessada nem alterada. Este pacote não contém credenciais privadas, `.git`, `.firebase`, `private/` ou dados pessoais.

## Correções efetivamente implementadas

1. **Exclusão perigosa removida do navegador:** o editor não apaga mais inscrições, cartazes ou documentos `events` em lotes. O ícone de lixeira arquiva reversivelmente (`archived=true`, `published=false`) somente eventos com `participantCount=0` e sem resultados, com verificação transacional. Eventos com participantes ou resultados ficam protegidos. Não há exclusão física cliente. O processo privado de eliminação, retenção e direitos de titulares permanece separado e pendente.
2. **Firestore Rules endurecidas:** nenhum `delete` de `events` ou `entries` pelo cliente; administrador não pode publicar `raffleStatus=drawn`; regras preservam contadores e parâmetros de eventos com inscritos; alteração cosmética de evento vencido pode ser permitida quando parâmetros protegidos não mudam; nenhuma gravação cliente de resultados oficiais. Resultados só são visíveis publicamente se o evento pai estiver publicado e não arquivado. A exclusão do cartaz pelo cliente também foi desativada.
3. **Consulta pública corrigida:** lista somente `published=true` E `archived=false`. Eventos antigos sem `archived` exigem normalização QA antes de publicar estas regras. Script `scripts/migrate-archived-qa.mjs` implementa dry-run por padrão, com projeto de destino fixo e confirmação explícita para a escrita.
4. **Consumo Firestore reduzido:** retirada a consulta global `getDocs` a cada 30 s. Lista de festas usa `onSnapshot` apenas com a aba Festas aberta e documento visível; o listener é cancelado ao sair da aba ou ocultar a página. Atualização visual do prazo não faz leituras Firestore.
5. **Apuração protegida:** ambos executores QA (o da aplicação e o isolado) rejeitam divergências entre `participantCount` e número de entries no snapshot e revalidam contagem na transação de publicação. Publicações carregam SHA-256 do snapshot usado, nos resultados público e privado. Depois do prazo, as Rules impedem novas entradas e exclusões pelo cliente. Sorteios arquivados não são elegíveis.
6. **Cadastro no mesmo dispositivo:** ao digitar outro @ quando o UID atual já se inscreveu, a UI conduz à confirmação de nova sessão anônima, em vez de apenas dizer que já se inscreveu. O @ continua sem ser autenticação ou prova de identidade.
7. **Salvamento de eventos:** imagem entra no cache apenas após confirmação da gravação; falha de atualização da lista depois do commit não transforma sucesso em falha de salvamento nem induz nova criação duplicada. Edição cosmética de evento aberto com prazo vencido não é rejeitada somente pelo relógio local quando a data não mudou.
8. **Sigilo administrativo:** limpar campo de importação da chave RSA e elementos privados ao encerrar sessão.
9. **Cabeçalhos de QA:** anti-frame, MIME nosniff, referrer, permissions e noindex em Hosting. O `public/config.js` segue apontando para `bandeco-homologacao` e NÃO pode ser usado em produção.
10. **Service Worker:** cache atualizado para `bandeco-v260-rc1-safety-listener`.

## Testes efetivamente executados NESTE ambiente

- `npm test`: **141/141 aprovados** (incluindo 6 novos testes de regressão v2.6.0).
- `cd github-qa-executor && npm test`: **6/6 aprovados**.
- `node --check` dos principais arquivos modificados: aprovado.
- **Não executados aqui:** `npm ci`, Playwright, Firebase Emulator, integração real online, Rules deploy ou GitHub Actions programado, porque as dependências e os serviços não foram configurados nesta sessão. **Não pressupor aprovação** dessas frentes.

## Pré-condições para publicar SOMENTE em QA

1. Criar backup da instalação existente, especialmente `private/`, `.git`, `.firebaserc`, `diagnostics/`.
2. Não sobrescrever a identidade local e nenhuma chave RSA.
3. `npm ci` e `npm test`; testes de Festas, segurança, administração, visual e QA executor.
4. No Firestore de **homologação**, inspecionar dry-run do backfill de `archived`, confirmar snapshot/backup e executar somente se seguro com credenciais QA.
5. Compilar as Rules no Firebase Emulator; corrigir falhas antes de qualquer deploy de Rules.
6. Somente após concluir 1–5 e obter resultados satisfatórios, publicar **Rules apenas de QA** e depois Hosting Preview apenas de QA, com `--project bandeco-homologacao` explícito.
7. Testar a listagem pública com dados legados, inscrito A/B no mesmo navegador, modalidades de sorteio e eventos com resultados.

## Bloqueios que ainda impedem deploy de produção

- A automação GitHub QA tem `cron: '17 * * * *'`, uma vez por hora, e **não há evidência independente de execução `schedule` real**. Não modifiquei frequência nem workflow remoto.
- O executor QA ainda depende de WIF/IAM e segredo RSA QA remotamente configurados; estes não constam do ZIP nem foram validados nesta sessão.
- Interface administrativa importa a chave privada RSA no navegador. A adoção e validação de uma CSP restritiva, limpeza aprimorada de dados sensíveis e avaliação de um fluxo mais isolado para descriptografia continuam necessárias antes de dados reais.
- Política de privacidade, responsável, contato, prazo de retenção e análise jurídica de distribuição promocional de prêmios ainda pendentes.
- Mesmo com UIDs separados, o Instagram digitado não comprova uma pessoa distinta; medidas antifraude e regulamento precisam de decisão.
- `public/config.js` deste ZIP é **somente QA**, contém cabeçalho noindex/banner de homologação e nunca deve ser publicado diretamente em `cardapioufmg`.
- A consistência de snapshot é assegurada sob as novas Rules que proíbem exclusões cliente e inscrições depois do prazo. Admin SDK privilegiado externo ou intervenções administrativas manuais ainda podem alterar dados; controles de operação e reconciliação são necessários.
- Não foi provado upgrade PWA remoto, query composta de Firestore com Rules no Emulator e leitura pública real após backfill. A implantação no QA depende dessas evidências.

**Status recomendado:** RC1 corrigida localmente; **GO condicional para homologação após testes**, **NO-GO para produção**.
