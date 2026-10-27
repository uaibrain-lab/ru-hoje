# O que tem no bandeco? — módulo Festas & Benefícios (v2.0 LAB)

**ESTADO: PARA TESTES LOCAIS. PROIBIDO PUBLICAR SEM AUTORIZAÇÃO EXPLÍCITA DO RESPONSÁVEL PELO PROJETO.**

## O que foi feito

- Nova aba **Festas**, independente do cardápio, sem pop-up ou banner intrusivo. Um card público informa data, local, organizador, imagem HTTPS opcional, link de ingressos e identificação de publicidade. A navegação segue disponível offline para o cardápio.
- Cadeado sem texto no rodapé; Google Authentication; proteção real por documento `eventAdminAccess/{uid}` e Firestore Rules, não pela aparência do cadeado.
- Painel responsivo para criar, editar, arquivar (desmarcar “Publicar”) e abrir inscrições, sem deploy ao alterar informações no Firestore. **Cadastro de imagens por URL HTTPS, sem Firebase Storage pago**.
- Cadastro de candidatos vinculado à conta Google. Primeiro informa o @, depois o sistema verifica se existe perfil **da própria conta Google**. Nunca verifica existência de @ de outras pessoas, evitando enumeração e vazamento. Nome, curso, e-mail e Instagram ficam num perfil cifrado. Consentimento opcional para marketing, desmarcado por padrão.
- Criptografia híbrida real: AES-256-GCM por perfil e RSA-OAEP 3072 bits para chave AES. O arquivo de chave **privada não vai para o Firebase nem para o ZIP entregue**. A chave pública é disponibilizada para cifrar os cadastros. Sem chave pública configurada, o cadastro falha fechado.
- Inscrição única por **UID do Google** em cada evento, com atualização da contagem em **transação** e regras de escrita combinada (`existsAfter` / `getAfter`). Isso **não prova controle do Instagram nem impede múltiplas contas Google**.
- Painel privado lê inscrições apenas para administrador; a descriptografia requer carregar manualmente a chave privada local. Validação de seguimento é manual. Pré-apuração usa `crypto.getRandomValues` com rejeição de viés. A publicação de resultados requer regulamento e referência de revisão/regularidade legal, e grava resultados públicos apenas com @ parcialmente mascarado.
- Regras Firestore deny-by-default e protótipo de teste dedicado para o Emulator. O resultado público não guarda lista de nomes, e-mails nem UID.

## Como testar em 2 minutos SEM Firebase

1. Aplique o patch com `APLICAR-FESTAS-LOCAL.ps1` na pasta de seu projeto `D:\Downloads\ru-hoje`.
2. Rode `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\ru-hoje\INICIAR-DEMO-LOCAL.ps1"`.
3. Acesse `http://127.0.0.1:8760/?festas-demo=1`.
4. Confira o cardápio, a aba Festas e o pequeno cadeado no rodapé. Na demonstração, o cadeado libera um **administrador fictício local** para testar inclusão e edição, mas os dados são só de memória. Recarregar apaga o que foi cadastrado. **Esse atalho existe APENAS em 127.0.0.1/localhost com `?festas-demo=1`; nunca libera privilégios em produção**.
5. Testes: `npm test`, `npm run test:e2e`, `npm run test:festas`.

## Configuração para testes reais no Firebase Emulator (não na produção)

1. Instale `firebase-tools` e Java 21 se faltarem. Em uma nova janela: `firebase emulators:start --config firebase.emulators.json --only auth,firestore --project demo-bandeco`.
2. Em `public/config.js`, mantenha `firebaseProjectId:"cardapioufmg"` apenas para leitura pública do cardápio; configure **somente** `firebaseWeb.projectId:"demo-bandeco"`, `firebaseWeb.apiKey:"demo-key"`, `firebaseWeb.authDomain:"demo-bandeco.firebaseapp.com"`, `firebaseWeb.appId:"demo-app"` e `eventEmulator:true` para os testes.
3. Execute `node scripts/generate-festas-keys.mjs` **uma única vez**. Isso cria `public/assets/festas-public-key.json` e `private/festas-chave-privada.json`. Faça backup privado e protegido desta última; sem ela, não será possível recuperar cadastros criptografados. Jamais dê commit em `private/`.
4. Use o Emulator UI `http://127.0.0.1:4000` para criar manualmente `eventAdminAccess/{UID-do-Google-de-teste}` com `enabled: true`. Descubra seu UID após login com o cadeado. Em nenhum caso dê `enabled: true` a contas não administradoras.
5. Abra o site local **sem** o parâmetro `?festas-demo=1`. Teste a autenticação, salvamento de um evento fictício, inscrições e decriptografia. Nenhuma ação do emulador altera a produção.
6. Teste regras de acesso com `npm run test:festas:security`. O script se recusa a executar se o projeto não for `demo-bandeco` ou se qualquer endereço do Emulator não estiver configurado.

## Antes de autorizar a primeira publicação

- **Não executar** `firebase deploy`, `git push`, `firebase use` ou qualquer script que publique. O fluxo de testes **não** faz essas operações.
- Revalidar com o projeto REAL que os dados de cardápio atuais não sejam afetados. Comparar a regra de `publicMenus/current` existente com a regra proposta, pois o projeto pode ter recebido atualizações desde este ZIP.
- A configuração Web pública do Firebase (`apiKey`, `authDomain`, `appId`) vem de Firebase Console → Configurações do Projeto → Seus apps → Configuração. Essa chave NÃO é uma credencial administrativa, mas deve ser restrita adequadamente por configuração do projeto. **Nunca embutir credenciais do Admin SDK ou a chave RSA privada no site.**
- Habilitar autenticação Google no Firebase Auth e domínios autorizados; app admin habilitado no Console, em documento ACL. Regras devem ser validadas nos emuladores e em revisão de segurança independente antes de tocar em dados reais.
- Política de privacidade atual é **modelo para desenvolvimento**, ainda falta informar contato do controlador, prazos de exclusão e direitos dos titulares. Inscrição real proibida enquanto essa documentação não estiver concluída.
- **Não confundir consentimento de publicidade com requisito para sorteios.** A caixa de e-mail promocional fica sempre desmarcada por padrão.
- Avaliar autorização prévia da Secretaria de Prêmios e Apostas para eventual promoção comercial: registrar formalmente organização responsável, condições, prêmios e mecanismo de apuração. A implementação técnica **não substitui autorização legal**. O painel exige atestar revisão; isso não equivale a verificar a regularidade externa.
- A apuração é aleatória criptograficamente, mas **não é comprovadamente imparcial contra um administrador mal-intencionado**: sem serviço confiável externo não se garante a impossibilidade de refazer sorteios privados, excluir inscrições da elegibilidade ou adulterar listas. Recomenda-se processo auditado e testemunhas; resultados reais **não devem ser publicados sem avaliação dessas garantias**.
- A máscara de @ reduz exposição, porém pseudônimos curtos podem ser reidentificados. Revise com a LGPD, especialmente se forem utilizados dados de menores de idade.
- Para custos, somente Firestore/Auth/Hosting dentro das cotas Spark; o módulo não usa Cloud Functions nem Storage. Consultar cotas antes de abrir inscrições em grande escala.

## Conteúdo

- `public/assets/festas.js`: aba, painel, login, inscrições e apuração
- `public/assets/festas-core.js`: validação, anonimização, criptografia
- `public/assets/festas-backend.js`: Firebase SDK carregado sob demanda
- `firestore.rules`: autorização e isolamento
- `public/privacidade-festas.html`: rascunho para testes
- `scripts/generate-festas-keys.mjs`: gera RSA localmente
- `scripts/test-festas-local.mjs`: E2E totalmente simulado, sem Firebase
- `scripts/test-festas-security-emulator.mjs`: tentativas de acesso direto à API local
- `firebase.emulators.json`: somente ferramentas de teste local

Este é um **pacote de desenvolvimento**, não uma declaração de conformidade jurídica nem de que foi validado para produção.
