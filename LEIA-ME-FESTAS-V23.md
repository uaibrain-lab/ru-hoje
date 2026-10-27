# Bandeco Festas v2.3 — navegação, tags e Sobre (somente laboratório)

## Mudanças da interface
- Navegação com três seções: **Cardápio (padrão)**, **Festas** e **Sobre**. Na largura de celular, a barra fica fixa no rodapé, com ícones e suporte à área segura de dispositivos com barra gestual.
- Em telas maiores, alternância com três opções e visual modernizado.
- Página **Sobre** reproduz integralmente o texto institucional fornecido pelo CATM.
- Cartões de festas exibem nome, organizadora, tags com emojis, data, hora, local, descrição **acima da imagem**, botões de ingressos/sorteios e arte abaixo do conteúdo textual.
- Removido o aviso visual repetido `Publicidade · Parceria CATM` dentro do cartão. A aba permanece identificada como PARCERIAS CATM.
- Editor de festas utiliza **upload de imagem com prévia**, sem campo alternativo de URL. Links antigos de imagem já registrados continuam preservados ao editar eventos que não enviem uma nova arte.
- Apenas **Open Bar 🍹, Open Food 🍔 e Festa à fantasia 🎭** vêm pré-cadastradas; o botão **Adicionar outra tag** abre o formulário de tag personalizada.
- Removido o texto redundante “(não limita inscrições)” do campo Número de ganhadores. A quantidade de contemplados **continua não limitando** a inscrição.

## Instalação

1. Garanta a base `D:\Downloads\ru-hoje` (v1.9.8 ou v2.x local).
2. Extraia o ZIP e execute `APLICAR-FESTAS-LOCAL.ps1` no PowerShell.
3. O instalador faz backup, aplica os arquivos, executa `npm test`, `npm run test:e2e` e `npm run test:festas`; se algum falhar, restaura a base.
4. Após instalação validada, execute `D:\Downloads\ru-hoje\INICIAR-DEMO-LOCAL.ps1` e acesse `http://127.0.0.1:8760/?festas-demo=1`.

## Restrições essenciais

- **NÃO executar deploy, nem git push, nem alterar Firebase de produção.**
- Sorteios, formulários com dados pessoais e apuração automática continuam **apenas em demonstração com dados fictícios** até os testes de segurança no Emulator e resolução das limitações de identidade/execução confiável.
- O upload real preparado para o Firestore somente poderá ser usado depois de regras testadas, revisão de custos/cotas e aprovação expressa.
- A autenticação/gestão real ainda exigirá configuração de administrador e validação das regras de acesso.
- O instalador não grava dados de participantes nem publica alterações.
