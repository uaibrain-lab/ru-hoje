# Bandeco Festas v2.4.1 — correção do E2E da navegação (laboratório local)

**Pacote cumulativo:** não é necessário instalar v2.4 antes. Mantém todos os arquivos e recursos da v2.4, sem alterar a experiência de produção.

## Erro corrigido
O E2E local em `scripts/test-festas-local.mjs` linha 33 contava quatro botões com `.bandeco-tabs button` e esperava três. O quarto botão é o controle **Recolher menu lateral**, visível somente no computador. Corrigimos a verificação para contar só `#tab-menu`, `#tab-festas`, `#tab-sobre` (via `aria-controls`) e confirmamos que o botão lateral está oculto no celular. A interface e o CSS não mudam.

## Instalação
1. Extraia este ZIP numa pasta nova, por exemplo `D:\Downloads\bandeco-festas-v241-patch`.
2. Execute `powershell -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\bandeco-festas-v241-patch\APLICAR-FESTAS-LOCAL.ps1"`.
3. O script fará backup, modificará apenas o projeto **local** em `D:\Downloads\ru-hoje`, executará `npm test`, `npm run test:e2e` e `npm run test:festas`. Reverterá os arquivos se ocorrer uma falha.
4. Após a instalação aprovada, execute `INICIAR-DEMO-LOCAL.ps1` e abra `http://127.0.0.1:8760/?festas-demo=1`.

## Limites antes de produção
- O teste local de navegação do navegador precisa passar no Windows; não foi executado aqui devido a uma restrição de acesso do Chromium a localhost.
- Inscrições reais, regras de segurança do Firebase Emulator, UID do administrador e apuração agendada de produção permanecem **não liberados** até validação independente.
- Não executar deploy, Git push, publicação de Firestore Rules ou manipulação de dados reais.
