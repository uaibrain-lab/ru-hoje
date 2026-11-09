# Recuperação da chave privada original de Festas

**Importante:** a execução do sorteio em produção em 09/11/2026 terminou com sucesso usando o secret `HUB_PROD_PRIVATE_KEY_JWK`. Isso indica que a chave privada ainda estava acessível ao executor naquele instante, embora o GitHub Secrets não permita visualizar seu valor.

A chave privada original **não pode ser substituída por outra** sem perder a capacidade de abrir inscrições já criptografadas com a correspondente chave pública. Não execute `npm run keys:festas`.

## Preparar o recebimento no seu Windows — sem alterar a produção

1. Na branch de integração, execute no PowerShell:
   ```powershell
   cd D:\Downloads\HUB-UFMG
   git pull --ff-only
   node scripts/festas-recovery-prepare.mjs
   ```
2. O script gera um par RSA 3072 **novo somente para a transferência protegida** em `%USERPROFILE%\Documents\HUB-UFMG-SEGREDOS`. A chave privada de recebimento fica exclusivamente no PC.
3. Compartilhe **apenas** `destinatario-recuperacao-PUBLICA.json` com o mantenedor responsável pela recuperação. O arquivo `destinatario-recuperacao-privada.pem` é secreto: **não compartilhe, não cole em chats, não anexe ao GitHub, não envie imagens ou capturas do conteúdo**.
4. Será preparada uma execução **temporária**, com a chave pública de recebimento fixada no código, acesso às credenciais existente do GitHub Actions e saída apenas no formato RSA-OAEP-SHA256 + AES-256-GCM. **Não existe workflow ativado para extrair a chave enquanto a chave pública ainda não foi informada**.
5. Após a execução, baixe o artifact criptografado `festas-chave-recuperacao.enc.json`. No mesmo Windows:
   ```powershell
   node scripts/festas-recovery-decrypt.mjs "C:\caminho\do\artifact\festas-chave-recuperacao.enc.json"
   ```
6. A chave original será salva em `%USERPROFILE%\Documents\HUB-UFMG-SEGREDOS\festas-chave-privada.json` e validada contra `public/assets/festas-public-key.json`. Se já existir o destino, a recuperação **não sobrescreve**.
7. Guarde uma cópia protegida em outro local e apague o workflow temporário após a recuperação. Não anexe a chave ao chat.

## Segurança
- O arquivo JSON criptografado poderá transitar por GitHub Actions, mas nunca a JWK original em texto puro.
- O GitHub Actions usa a chave original apenas no runner; nem logs nem artifact a contêm sem criptografia.
- O destinatário pode descriptografar exclusivamente no PC com sua chave privada de recebimento.
- Não criar esse workflow com entrada livre de chave pública em `workflow_dispatch`: isso permitiria que outros com permissão de execução pedissem a exportação para chave própria. O destinatário deve estar **fixado** no código e a execução deve ser revisada.
- O workflow temporário deve ser acionado somente pelo administrador autorizado, após revisão.

Se o secret foi removido **depois** da apuração confirmada, será necessário recuperar uma cópia da chave original em backup local; um segredo apagado do GitHub não pode ser recuperado diretamente pela interface.
