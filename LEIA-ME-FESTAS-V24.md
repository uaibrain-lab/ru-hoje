# Bandeco Festas v2.4 — PRÉ-PUBLICAÇÃO, somente localhost

**Não autoriza deploy, push, alteração nas regras de produção ou inscrições reais sem validação final.**

## Entregue
- Navegação desktop: menu lateral fixo, recolhível, persistência da preferência. Celular: rodapé com Cardápio, Festas e Sobre.
- Cadeado **inicialmente oculto**, revelado após 5 cliques consecutivos na foto CATM do topo, dentro de 2,5s. O cadeado não é autenticação.
- Autenticação Google para administrador; regras exigem documento ÚNICO `eventAdminAccess/owner` com `uid` do proprietário e `enabled:true`, criado APENAS com privilégios administrativos.
- Festa: arte via upload otimizado, tags livres, ingressos, descrição, dados e regras padrão. Sem deploy por festa (Firestore).
- Participação: Firebase Auth anônimo em segundo plano (sem tela de login para participante); um formulário criptografado RSA/AES por UID; contador incrementado atomicamente; inscrição pelo mesmo aparelho fica curta; nenhum dado pessoal público.
- Sorteios reais: executor Node/Admin SDK que seleciona pessoas com aleatoriedade criptográfica, deduplica identificadores e publica resultados mascarados em transação única. Tarefas do GitHub Actions propostas a cada 5 minutos; frequência aproximada, **não** instante garantido. O cron permanece **DESLIGADO** até `RU_FESTAS_DRAW_ENABLED=true`.
- Resultados: dados mascarados em `results/official`, UID selecionados em `resultPrivate/official` somente admins; dados brutos cifrados em `eventProfiles/{uid}`.
- Administração Formulários: leitura privada somente após fornecer chave JWK **localmente**; CSV protegido; operações de exclusão real precisam da revisão de descarte dos resultados antes de serem disponibilizadas ao público.

## Limitações importantes
1. **Ninguém consegue provar posse de Instagram apenas digitando @.** Por isso, não há busca pública da base de @: sem autenticação externa, a inscrição pode ser associada automaticamente somente à mesma sessão anônima no mesmo navegador. A mesma pessoa em outro aparelho confirma nome/e-mail novamente. Identificadores duplicados são deduplicados pelo executor privado, mas isso não garante que o @ pertença ao inscrito. A confirmação de seguidor permanece manual.
2. A apuração roda em GitHub Actions: agendamentos podem atrasar ou ocasionalmente não executar; habilitar verificações operacionais e eventual acionamento manual. Não são Cloud Functions pagas.
3. Firestore sem App Check não protege contra automação massiva. Antes de produção, configurar antiabuso, testar limites e quotas Spark e emuladores.
4. **O executor exige credenciais administrativas e chave RSA privada no segredo do GitHub.** Nunca enviar chave privada para repositório, navegador público, pacote ZIP ou mensagens do chat.
5. Regras/inscrições reais não estão validadas em emulador neste ambiente. Não autorizar deploy até testes de acesso indevido e de cadastro aprovados, incluindo concorrência.
6. Exclusão completa de cadastros já contemplados e notificações por e-mail precisam de fluxo administrativo auditável; botões reais destrutivos permanecem desabilitados no laboratório até essa fase.
7. Um sorteio público pode estar sujeito a obrigações legais, independentemente de haver um campo de regulamento em URL. O editor possui apenas texto de regras, como solicitado.

## Primeira execução / teste local sem Firebase
1. Aplicar `APLICAR-FESTAS-LOCAL.ps1` sobre `D:\Downloads\ru-hoje` e aguardar npm test + E2E.
2. Executar `INICIAR-DEMO-LOCAL.ps1` e acessar http://127.0.0.1:8760/?festas-demo=1
3. Selecionar RU, navegar entre abas. Clicar 5× seguidas na foto CATM; cadeado aparece. Clicar cadeado para administrar a demonstração fictícia.
4. Criar festa, subir foto, selecionar tags, definir sorteio com 2 ganhadores e 3 suplentes e confirmar que 5+ pessoas se inscrevem. Recarregar e conferir navegação/tema.

## Antes do modo real (não fazer sem autorização do usuário)
1. Informar **UID da conta Google administradora** (Firebase Console > Authentication > Users). Nunca usar e-mail como segredo, nem pedir senha. Configurar Google Sign-In no Firebase Auth e, para participação, Anonymous Auth.
2. Provisionar em emulador via Admin SDK o documento único `eventAdminAccess/owner = {uid: '<UID>', enabled: true}`. Apenas o dono pode ler. Testar contas diferentes, anônimas e não autenticadas.
3. Gerar RSA 3072 localmente com `npm run keys:festas`; backup seguro de `private/festas-chave-privada.json`, nunca versionar. Se perder essa chave, os cadastros ficam indecifráveis.
4. Ativar emuladores, executar `npm run test:festas:security`. Testar de forma adversarial inscrição e incremento atômico; nenhuma regra em produção antes disso.
5. Só depois de aprovação manual, configurar a Web App Firebase (`public/config.js`) e credenciais secretas do executor em GitHub Secrets: `RU_FESTAS_FIREBASE_SERVICE_ACCOUNT` e `RU_FESTAS_PRIVATE_KEY_JWK`; variável `RU_FESTAS_DRAW_ENABLED` deve continuar `false` até a aprovação explícita.
6. Revisar a integração real do cadastro, cenários de exclusão/privacidade, prevenção de abuso, acessibilidade e disposições legais.

**Este patch nunca executa `firebase deploy`, `git push`, `firebase deploy --only firestore:rules` ou faz chamadas com privilégios à produção.**
