# Hub UFMG — recuperação definitiva da consulta bloqueada por CORS (16/11/2026)

## Diagnóstico confirmado por navegador real

`https://hubufmg.web.app` foi impedido de ler o JSON de `fump.ufmg.br:3003`:
`No 'Access-Control-Allow-Origin' header is present`.

Um `GET` que abre em outra aba **não** significa que `fetch()` a partir do Hub pode ler o JSON. `mode:no-cors` também não funciona (body opaco). Falhas HTTP 500 podem existir **além** do CORS e precisam ser diagnosticadas no servidor. O erro `wss://hubufmg.web.app/ws/ws` não faz parte desse problema.

## Solução em camadas

1. Cloudflare Worker público de **leitura** `worker/fump-proxy.mjs`, usando Workers Free.
2. O Worker consulta apenas a FUMP (endpoints whitelist), valida ID/schema/data e aplica cache de 4 minutos para menus com pratos; 30 segundos para resposta vazia; nunca cacheia HTTP 500/timeout.
3. O Worker publica a resposta com `Access-Control-Allow-Origin` somente para `hubufmg.web.app` e `hubufmg.firebaseapp.com`. Não precisa de credenciais Firebase e não escreve no Firestore.
4. O navegador usa `window.RU_CONFIG.fumpProxyUrl` para ler o JSON. Se falhar, preserva o snapshot Firestore/local.
5. O sincronizador GitHub usa a mesma origem quando `FUMP_PUBLIC_PROXY_URL` está configurada. Sua conta de serviço existente continua a única autorizada a gravar em `publicMenus/current`.
6. Não altera o plano Firebase Spark nem exige Cloud Functions/Cloud Run.

**Atenção:** o Worker usa IPs da Cloudflare, não o IP do usuário. É um intermediário legítimo para cumprir a política CORS; ele não garante que a FUMP aceite conexões de datacenter. Só ativar depois de testar um JSON real com pratos nos endpoints.

## Publicar Worker (uma vez)

1. Crie/login no Cloudflare Workers Free: https://dash.cloudflare.com/ .
2. No PowerShell Windows, em uma cópia do repositório `uaibrain-lab/ru-hoje` atualizado:

   ```powershell
   npx.cmd --yes wrangler login
   npx.cmd --yes wrangler deploy --config worker/wrangler.toml
   ```

3. Copie a origem HTTPS do Worker exibida ao final (ex.: `https://hub-fump-proxy.SEUSUBDOMINIO.workers.dev`).
4. Antes de conectar o site, abra (troque pela sua origem):

   ```
   https://hub-fump-proxy.SEUSUBDOMINIO.workers.dev/api/menu?id=6&data=2026-11-16
   ```

   Data deve ser de hoje até 14 dias à frente, horário Brasília. Deve responder HTTP 200, conter `cardapios: []` (sem dados) ou pratos reais; **para ativar**, precisamos de pratos em pelo menos um RU. Se responder `UPSTREAM_HTTP` (502) ou `UPSTREAM_CONNECT_FAILED` (503), não ative: a rede Cloudflare ou a própria FUMP ainda está impedindo a consulta.

5. Executar a configuração + validação + deploy do Hosting (sem reescrever Firebase Rules):

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\activate-fump-proxy.ps1 -WorkerUrl "https://hub-fump-proxy.SEUSUBDOMINIO.workers.dev"
   ```

   O script exige Node.js 22+, GitHub CLI `gh` autenticado e Firebase CLI autenticado. Ele testa as quatro fontes usando `Origin: https://hubufmg.web.app`, exige pelo menos um RU com pratos, executa testes do proxy, define GitHub variable `FUMP_PUBLIC_PROXY_URL`, configura `public/config.js`, publica **somente Firebase Hosting** no projeto `hubufmg` e solicita uma execução manual de sincronização Firestore.

   Sem GitHub CLI: use `-SkipGithubConfiguration` somente para ativar a experiência no site; então configure manualmente a variável de repositório `FUMP_PUBLIC_PROXY_URL` e dispare o workflow `hub-production-cardapios.yml` em modo `apply`.

6. Confirme no navegador em `hubufmg.web.app` se as requisições agora vão para `/api/menu` na origem Worker e retornam 200 sem erro CORS; após sincronização confirmada, audite `publicMenus/current` por RU/data.

## Limites e segurança

- Restrito aos IDs 1, 2, 5, 6. Saúde/Direito usam ID 2.
- Aceita apenas GET/OPTIONS e datas de hoje até D+14.
- Não faz proxy de URL arbitrária. Respostas inválidas não são publicadas.
- CORS restringe **leitura do navegador**, não é autenticação; qualquer cliente HTTP pode forjar Origin. Se aumentar o uso, aplique limites de taxa no Cloudflare.
- Cache do POP Cloudflare reduz consultas repetidas, mas o Firestore continua como contingência compartilhada.
- Workers Free tem limite de requisições; consulte as cotas atuais na documentação Cloudflare. Não há garantia de que serviços de terceiros operem eternamente.
- Jamais configurar `NODE_TLS_REJECT_UNAUTHORIZED=0` ou liberar escrita anônima no Firestore.

## Casos nos quais não resolve

1. Worker não consegue alcançar FUMP (IP/porta bloqueados).
2. A própria FUMP retorna 500 com a mesma URL.
3. O JSON oficial traz `cardapios: []` para o RU/data, sem dados para exibir.

Nesses casos, precisamos de outro coletor com rede brasileira confiável ou solicitar à FUMP autorização CORS/IP. Publicar repetidamente o Hosting **não produz cardápio novo**.
