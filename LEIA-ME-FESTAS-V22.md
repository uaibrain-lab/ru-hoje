# Bandeco — Festas & Benefícios v2.2 (LABORATÓRIO)

**Esta entrega é local. Não há autorização para deploy, push para main, alteração de regras, credenciais ou dados de produção.** A versão pública do Bandeco deve continuar inalterada até o responsável aprovar expressamente a publicação após os testes.

## Aplicação local

Baixe e extraia `bandeco-festas-v2.2-laboratorio-sem-deploy.zip` em `D:\Downloads\bandeco-festas-v22-patch`. Execute `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\bandeco-festas-v22-patch\APLICAR-FESTAS-LOCAL.ps1"`.

O instalador opera somente em `D:\Downloads\ru-hoje`, cria backup, instala arquivos, executa `npm test`, `npm run test:e2e` e `npm run test:festas`. Se algum comando falhar, restaura os arquivos copiados anteriormente. **Não executa deploy, push ou alterações remotas.** A validação visual precisa passar no Windows; não foi possível rodá-la no Chromium do ambiente de criação.

Depois de instalar, inicie a demo com `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\ru-hoje\INICIAR-DEMO-LOCAL.ps1"` e abra `http://127.0.0.1:8760/?festas-demo=1`.

## Interface de festas

- A aba Festas preserva o cardápio como tela inicial, sem pop-ups de publicidade.
- Festa: nome, atlética, data, horário, local, imagem, tags e botão **INGRESSOS 🔥**. Somente links de ingressos HTTPS válidos são aceitos para proteger os visitantes. Não há exigência de URL de regulamento ou campo de fundamento jurídico no editor.
- Tags predefinidas: Open Bar, Open Food, Festa à fantasia, Chopp liberado, Shows ao vivo, Universitária, Pré-venda e Benefício CATM. É possível digitar novas tags (2–28 caracteres), que passam a integrar o catálogo privado reutilizável. Cada festa pode ter até 8 tags.
- Upload de PNG/JPG/WebP até 3 MB. O navegador redimensiona e recodifica como WebP, produzindo uma imagem com menos de 240 KB. Para o uso futuro com Firestore, a imagem é enviada a `eventPosters/{eventId}` (documento independente, no máximo 330 KB de base64). O documento somente pode ser escrito pelo admin autorizado; a leitura pública exige uma festa publicada. A imagem fica apenas no navegador durante a demonstração local.
- O painel fica atrás do cadeado discreto e possui duas abas, **Festas** e **Formulários**.

## Fluxo do sorteio na DEMO

1. Administrador escolhe quantidade de **ganhadores**, quantidade de **suplentes**, data/hora, regras em texto e abre inscrições. Esses números **não limitam inscrições** nem aparecem no cartão público.
2. As regras podem ser salvas como padrão para eventos posteriores; não exigem link nem referência jurídica no formulário. O texto admite quebras de linha.
3. Visitante clica em **Sorteio**, vê regras/data, confirma leitura e informa @ do Instagram.
4. Na demonstração local, @ previamente cadastrado recebe inscrição confirmada, sem refazer o cadastro. Caso contrário, informa nome e e-mail e opta (checkbox inicialmente **desmarcado**) por receber publicidade, descontos e avisos.
5. No horário configurado, **com o navegador da demonstração aberto**, um sorteio fictício é executado por `crypto.getRandomValues`. A lista pública exibe somente nomes parcialmente censurados e o botão torna-se **Resultados!**.
6. Na aba Formulários, a administração fictícia consulta @, nome, e-mail, consentimento, número de participações e eventual situação como ganhador ou suplente. Há exportação CSV protegida contra fórmulas, exclusão individual e exclusão de todos os cadastros fictícios.

**Dados da demo:** cadastros, inscrições e resultados existem **somente na memória**. O catálogo de tags e o texto padrão podem ser guardados no localStorage da própria demonstração; não incluem os nomes ou e-mails dos participantes. Recarregar a aba apaga cadastros e resultados fictícios.

## Segurança / limitações obrigatórias para qualquer publicação futura

- **Inscrição real, verificação por @, exportação de cadastros reais e sorteio automático real permanecem DESABILITADOS.** Um @ público não comprova titularidade. Uma consulta que revela se um @ está no banco expõe pessoas à enumeração e permite inscrições fraudulentas. A experiência desejada pode ser preservada, mas exige verificação privada do titular e backend confiável, sem retornar existência do perfil a qualquer pessoa.
- O navegador não executa tarefas depois de fechado. Sorteios agendados de verdade exigem um executor privado, controle transacional, trilha de auditoria e publicação imutável. Nenhum resultado real será calculado pela demonstração.
- Para eventos sem sorteio, o design preparado permite gerenciamento no Firestore sem deploy por festa **depois que o módulo, o Firebase Auth e as regras forem devidamente validados e publicados uma única vez**. O laboratório não modifica o banco real.
- A imagem pelo Firestore evita Firebase Storage, mas aumenta leituras, tráfego e consumo de cotas Spark. Não é adequado para artes em alta resolução, vídeos ou grande volume de eventos. A capacidade real deve ser medida antes do lançamento.
- O acesso administrativo depende de UID autorizado e Security Rules; o cadeado é apenas discrição visual. Chaves privadas nunca entram em `public/` ou Git. O cadastro criptografado de versões anteriores continua como componente isolado; a demonstração **não armazena PII real**.
- Mesmo sem URL de regulamento ou referência jurídica no formulário, **as obrigações legais eventualmente aplicáveis a promoções comerciais continuam existindo**. Retirar um campo não as elimina.
- Teste as regras no **Firebase Emulator, não no projeto real**: `npm run test:festas:security`. A ferramenta exige SDK e Firebase CLI disponíveis; caso não possam rodar, a validação de segurança continua pendente.

## Critérios de aprovação para futura publicação

`npm test`, `npm run test:e2e`, `npm run test:festas`, testes no emulador, revisão de segurança das consultas privadas e executor de apuração, testes em celular e aprovação explícita de quem administra o projeto.
