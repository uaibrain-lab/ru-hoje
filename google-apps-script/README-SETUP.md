# Relay da API FUMP para o Hub UFMG

## Por que existe

Em 16/11/2026, os runners Ubuntu e Windows do GitHub Actions resolveram o DNS de `fump.ufmg.br`, mas as conexões a `https://fump.ufmg.br/` (443) e `https://fump.ufmg.br:3003/` terminaram em `UND_ERR_CONNECT_TIMEOUT`. O Chromium headless no Ubuntu também não conseguiu abrir a página oficial nem a API. O usuário confirmou que o endpoint abre no navegador de sua máquina.

Este relay usa `UrlFetchApp` no ambiente Google para fazer somente as duas consultas oficiais aprovadas. O GitHub continua validando os dados e publicando no Firestore com WIF; o relay não recebe credencial Firebase, não escreve dados e não aceita URL arbitrária.

## Implantação única na conta Google

1. Abra https://script.google.com/ e crie um projeto novo chamado **Hub UFMG — Relay FUMP**.
2. Copie todo o conteúdo de `google-apps-script/FumpRelay.gs` para o editor `Code.gs`.
3. Abra **Configurações do projeto → Propriedades do script → Adicionar propriedade**:
   - Nome: `FUMP_RELAY_TOKEN`
   - Valor: um token aleatório de 64 caracteres hexadecimais.
4. Gere um token no PowerShell (não o publique nem o envie no chat):
   ```powershell
   $token = -join (1..64 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
   Set-Clipboard $token
   Write-Host "Token gerado e copiado para a área de transferência."
   ```
   Cole esse mesmo valor na propriedade de script e, depois, no GitHub Secret descrito abaixo. Não o grave em arquivo nem no repositório.
5. Em **Implantar → Nova implantação → Aplicativo da Web**:
   - Executar como: **Você**
   - Quem pode acessar: **Qualquer pessoa**
   - Implantar e autorizar o escopo de requisição externa.
6. Copie a URL terminada em `/exec` da implantação. Não compartilhe o token.

## Configuração do GitHub

No repositório https://github.com/uaibrain-lab/ru-hoje:

1. Em **Settings → Secrets and variables → Actions → Variables**, crie:
   - `FUMP_RELAY_URL` = URL da implantação Apps Script terminada em `/exec`.
2. Em **Settings → Secrets and variables → Actions → Secrets**, crie:
   - `FUMP_RELAY_TOKEN` = o mesmo token aleatório de 64 caracteres hexadecimais.
3. Não crie variáveis para credenciais Firebase. O workflow continua usando a identidade WIF que já existe.

## Teste antes de ativar

O endpoint aceita somente:
- `resource=restaurants` (lista oficial de RUs);
- `resource=menu` com IDs `1,2,5,6`, uma data por consulta, de hoje até os próximos seis dias.

Não aceita hosts, caminhos ou IDs arbitrários. `cardapios: []` é devolvido como resposta vazia não autoritativa; não prova fechamento do RU. O token é validado em tempo constante. O código não registra token, corpo das refeições ou URL com query.

Antes de integrar/publicar, execute o workflow de diagnóstico read-only na PR e confirme que:
- Apps Script responde com envelope `ok: true`;
- a consulta ID 6 retorna a mesma estrutura que o link oficial que o usuário confirmou;
- os demais três IDs mantêm os respectivos mapeamentos;
- nenhuma escrita Firestore foi feita.

## Limitações

O Web App precisa ser implantado uma vez e autorizado pela conta Google do proprietário. Google Apps Script também tem quotas e disponibilidade próprias; não há como prometer funcionamento literalmente para sempre. A implantação é um relay de leitura, não um mecanismo de bypass de autenticação do Firebase. Se o host da FUMP também bloquear os IPs de saída do Google, será necessário solicitar à FUMP um endpoint/proxy suportado ou hospedar um coletor numa rede autorizada.
