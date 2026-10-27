> Documento histórico da v2.1. Para a versão atual consulte **LEIA-ME-FESTAS-V22.md**.

# Bandeco — Festas v2.1 (laboratório sem deploy)

## Instalação

Use `APLICAR-FESTAS-LOCAL.ps1` no PowerShell. O script valida o projeto em `D:\Downloads\ru-hoje`, faz backup, testa o cardápio e a demonstração de Festas. Em falha, restaura arquivos antigos. Nenhum envio ao GitHub ou Firebase.

A demonstração é acessível **somente** em `http://127.0.0.1:8760/?festas-demo=1`, com `INICIAR-DEMO-LOCAL.ps1`.

## Visual e recursos testáveis

- Aba **Festas** independente do cardápio; nome, atlética, horário, local, imagem, tags, e botão **INGRESSOS 🔥** com URL HTTPS externa.
- Cadeado discreto no rodapé, painel com duas abas **Festas** e **Formulários**.
- Editar festas fictícias, inserir link de ingresso, tags (Open Bar, Open Food etc.) e **selecionar uma imagem local PNG/JPG/WebP até 3 MB** para pré-visualização. A imagem local fica apenas na memória e não é salva para o público.
- Sorteio fictício: regras escritas no modal, data/hora de apuração, @, reutilização de cadastro fictício, nome, email e marketing desmarcado.
- Ganhadores e suplentes configuráveis no painel: **não limitam participantes** e **não aparecem no cartão público**. Ex.: com 2 ganhadores e 1 suplente, 50 participantes ainda podem se inscrever.
- Na demo, enquanto o navegador estiver aberto, o relógio local confere a hora e executa apuração fictícia usando `crypto.getRandomValues`. A lista pública exibe nomes mascarados; administrador fictício pode listar os cadastros, exportar CSV e excluir individualmente ou em massa.
- O CSV protege contra fórmulas. Cadastro e inscrições fictícios permanecem em memória: recarregar a página apaga-os. Não colocar dados pessoais reais na demo.

## LIMITAÇÕES CRÍTICAS PARA USO REAL

**A inscrição real está intencionalmente bloqueada.** Um @ de Instagram é público e não autentica seu proprietário. Permitir que a pessoa recupere/registre o cadastro de qualquer @ sem prova de controle viabiliza inscrições por terceiros e enumeração de usuários. Para uso real sem login externo, será preciso uma verificação interna do titular (p.ex. código enviado a um e-mail comprovado) e um backend seguro para validação.

**A apuração automática real não está implementada.** `setInterval` em uma página web só executa com a página aberta. Uma apuração em horário agendado precisa de executor privado confiável e protegida contra repetição, alteração do resultado e contagens adulteradas. GitHub Actions pode agendar execuções, mas não oferece horário exato garantido. Firebase Functions programadas requerem Blaze. Até escolher executor Spark compatível, não habilitar sorteios reais.

**Upload direto de imagem para produção não está implementado.** Para eventos reais, o cadastro aceita **URL HTTPS de imagem já hospedada**; o seletor de arquivo funciona apenas na demonstração local. Persistir imagens sem deploy exigirá uma solução separada de armazenamento e regras de acesso, respeitando o orçamento.

O painel no navegador não fica literalmente secreto no código: a segurança efetiva depende de autenticação administrativa, regras de Firestore e segregação de dados. A interface administrativa real mantém login Google restrito e não concede acesso aos cadastros reais neste laboratório. Não há liberação de inscrições, leitura de dados pessoais, exportação ou exclusão reais sem testes dos emuladores e auditoria da arquitetura.

A remoção da exigência de URL de regulamento do formulário não elimina exigências legais eventualmente aplicáveis a promoções comerciais. A responsabilidade e as regras da ação devem ser avaliadas antes de operar um sorteio real.

**PRODUÇÃO CONGELADA:** não rodar `firebase deploy`, não fazer `git push`, não usar o Console do Firestore de produção e não aplicar regras reais enquanto não houver testes e aprovação expressa do proprietário.
