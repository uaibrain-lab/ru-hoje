# RU Hoje — pacote de homologação para revisão técnica

Data da entrega: 23/10/2026  
Projeto local: `D:\Downloads\ru-hoje-homologacao`  
Firebase QA: `bandeco-homologacao`  
Firebase produção: `cardapioufmg`

## Pacote entregue

- ZIP: `D:\Downloads\ru-hoje-homologacao-v259-entrega-20261023.zip`
- Conteúdo verificado: 120 arquivos de fonte/configuração/testes.
- O SHA-256 final do ZIP é informado junto ao arquivo entregue; ele não é gravado dentro do próprio ZIP para evitar uma referência circular.
- O ZIP inclui o diretório-fonte `github-qa-executor`, inclusive seus workflows e arquivos de pacote, mas não inclui o metadado `.git`.
- Para reproduzir dependências, executar `npm ci` na raiz e, se necessário, em `github-qa-executor`.

## Resumo executivo

Esta pasta é a versão de homologação do projeto “O que tem no Bandeco?”. A correção mais recente foi feita exclusivamente no QA:

1. O documento público `publicMenus/current` de `bandeco-homologacao` foi sincronizado com o snapshot público atual de `cardapioufmg`, sem escrever em produção.
2. O RU Setorial I voltou a aparecer em 23/10/2026; a prévia confirmou 10 itens no almoço e `Strogonoff de Carne` em `PRATOS PRINCIPAIS`.
3. A aba Festas recebeu olhos aberto/fechado, lixeira funcional, seção recolhida `Ocultas` e exclusão QA de festas sem resultado oficial, inclusive com inscrições.
4. Eventos com resultado oficial público ou privado continuam protegidos contra exclusão.

A sincronização do cardápio é um snapshot de homologação. Para produção, o coletor oficial precisa continuar atualizando `publicMenus/current`; não se deve apontar o QA diretamente para produção como solução permanente.

## Ambientes e limites

- Nova prévia QA: https://bandeco-homologacao--qa-v259-controls-20261023-veznw5sm.web.app
- Projeto QA alterado: `bandeco-homologacao`.
- Projeto produção: `cardapioufmg`; não recebeu deploy, Rules, escrita de Firestore ou alteração de Hosting nesta entrega.
- Nenhuma chave privada, token, cookie ou segredo foi incluído neste pacote.
- A chave RSA privada continua somente em `private/` local e foi excluída do ZIP.

## Alterações relevantes presentes no código

### Cardápio

- `public/config.js` da homologação aponta para `bandeco-homologacao`.
- `public/assets/app.js` não foi alterado nesta correção e continua usando o documento público QA.
- `public/data/cardapios.json` permanece sem dados simulados.
- O Firestore QA recebeu somente o documento público `publicMenus/current`, com o snapshot oficial lido de produção. Nenhuma coleção privada foi copiada.

### Festas e administração

- `public/assets/festas.js`: ícones SVG de olho e lixeira, separação entre festas publicadas, `Ocultas` e `Arquivadas`, exclusão em lotes das inscrições e bloqueio de eventos com resultado.
- `public/index.html`: seção recolhida `Ocultas` no gerenciador.
- `public/assets/styles.css`: estilos dos ícones, lixeira e seções recolhíveis.
- `firestore.rules`: administrador QA pode excluir evento sem resultado oficial; resultados `official` e `resultPrivate/official` impedem exclusão.
- `tests/festas-v257f-r2.test.mjs` e `tests/festas-v257g.test.mjs`: testes atualizados para a política QA atual.
- `scripts/test-festas-local.mjs`: teste local cobre ícone, ocultação e retorno da festa para a lista principal.

### Classificação de refeições

- A regra validada para `Strogonoff` sem tipo cadastrado mantém o prato como principal; somente variantes explicitamente vegetarianas/veganas são vegetarianas.
- A classificação oficial da API continua tendo precedência sobre exceções de compatibilidade.

### Executor de sorteios

- O executor QA utiliza Workload Identity Federation/OIDC e a conta QA dedicada.
- A chave RSA QA não está no código nem no ZIP.
- A execução manual remota foi validada anteriormente.
- Ainda não há prova de uma execução disparada por `schedule`; não classificar o agendamento como operacional sem essa evidência.

## Testes executados

- `npm test`: 135/135 aprovados.
- `npm run test:e2e`: aprovado.
- `npm run test:festas`: aprovado.
- `npm run test:festas:visual:v245`: aprovado, 25 capturas.
- `npm run test:festas:security`: aprovado no Firebase Emulator, incluindo concorrência, isolamento, exclusão de festa com inscrição e bloqueio de resultado publicado.
- `node --check public/assets/festas.js`: aprovado.
- Rules QA compiladas e liberadas no projeto `bandeco-homologacao`.
- Prévia online recarregada após a sincronização: cardápio exibido e classificação de Strogonoff confirmada.

O Firebase CLI exibiu apenas um aviso local de verificação de atualização ao encerrar o Emulator; os scripts terminaram com código 0.

## Como outra IA deve revisar

1. Confirmar que todos os comandos Firebase usam explicitamente `--project bandeco-homologacao`.
2. Confirmar que não existe referência de publicação, Rules ou escrita em `cardapioufmg`.
3. Revisar `public/assets/app.js`, `public/config.js`, `public/data/cardapios.json` e o formato de `publicMenus/current`.
4. Verificar que o coletor não inventa pratos quando a FUMP não fornece dados.
5. Revisar `firestore.rules` para impedir leitura de PII, autoelevação de privilégio, publicação de resultado pelo navegador e exclusão de evento apurado.
6. Revisar a exclusão em lotes: inscrições são removidas antes do evento; perfis são preservados porque podem ser usados em outros eventos.
7. Executar as suítes listadas acima em um Emulator limpo.
8. Testar a prévia em 360, 390, 768 e 1440 px; conferir sem overflow, modais, cardápio, Festas, PWA e console.
9. Confirmar no GitHub que o executor QA não recebe secrets em PRs/forks e não tem fallback para produção.
10. Antes de produção, exigir uma execução agendada real do GitHub Actions e revisão independente das Rules, do IAM/WIF, da chave RSA e do rollback.

## Pendências antes de produção

- Não fazer deploy de produção sem autorização específica.
- Provar uma execução real do workflow por `schedule`; `workflow_dispatch` não é suficiente.
- Confirmar sincronização contínua do cardápio no ambiente que será publicado.
- Revisar se a exclusão física de festas de teste deve existir em produção; esta permissão foi mantida restrita ao QA.
- Fazer revisão final de domínio, Analytics, PWA, Rules, WIF, secrets e rollback.

## Conteúdo excluído do ZIP por segurança

- `node_modules/` e `github-qa-executor/node_modules/`: dependências regeneráveis.
- `.git/` e `.firebase/`: metadados locais.
- `private/`: chave RSA privada.
- `diagnostics/`: diagnósticos, screenshots e cardápios reais de coleta não versionados.
- `*.log`: logs locais do Emulator.

Os fontes versionáveis, incluindo `.github/`, `scripts/`, `tests/`, `public/`, Rules, workflows e o diretório-fonte do executor QA estão incluídos no ZIP, exceto dependências e segredos.

## Rollback

- Código local: restaurar o backup em `diagnostics/backup-festas-controles-20261023` para os arquivos da correção visual/administrativa.
- Prévia QA: publicar novamente uma versão validada anterior.
- Cardápio QA: restaurar o snapshot público QA anterior ou executar novamente o coletor oficial; não alterar produção para fazer rollback.
