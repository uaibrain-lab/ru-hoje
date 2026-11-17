# Hub UFMG — operação sob demanda (16/11/2026)

## Arquitetura
- O Hosting estático do Firebase serve o PWA e conteúdo auxiliar.
- Quando o visitante abre o PWA, troca RU/data ou retoma a aba, o navegador consulta **o Cloudflare Worker** HTTPS; ele consulta os endpoints oficiais FUMP.
- Para evitar requisições repetidas, o cliente guarda apenas pratos validados localmente e faz pré-buscas limitadas em segundo plano.
- Não há necessidade de GitHub Actions/Firestore escritor para atualizar os cardápios exibidos enquanto há visitas. Nenhum aplicativo aberto = nenhuma consulta nova; a próxima visita inicia a consulta.
- O documento `publicMenus/current` do Firestore é apenas contingência antiga. O fallback estático `public/data/cardapios.json` está obsoleto e não deve ser tratado como publicação atual.

## Publicação manual (uma vez após alteração de código)
No Windows PowerShell, com `D:\Downloads\Hub-UFMG` atualizado:
```powershell
git pull --ff-only origin main
# Worker e suas opções de placement e cache global/tiered:
npx.cmd --yes wrangler deploy --config worker/wrangler.toml
# Hosting estático (não altera Firestore Rules):
npx.cmd --yes firebase-tools@15.22.1 deploy --only hosting --project hubufmg --non-interactive
```
Deploy de Hosting só é necessário se o código do site mudar, **não para renovar cardápios ou datas**.
Não rodar `firebase deploy` sem `--only hosting` neste procedimento.

## Verificação rápida
1. URL Worker `https://hub-fump-proxy.hubufmg.workers.dev/api/menu?id=6&data=<HOJE_BR>` deve fornecer HTTP 200 com CORS `https://hubufmg.web.app`, resposta oficial datada e pratos quando disponíveis.
2. Testar dos próprios PCs ou telefones a partir de regiões/redes distintas. HTTP 503 indica falha real de upstream; não é substituído por cardápio vazio.
3. `https://hubufmg.web.app/service-worker.js` deve incluir `hub-v270-20261116-demand-ready-r1`, e `/assets/app.js` deve implementar `missingMenuForDate`.
4. PWA previamente instalado deve atualizar **sem limpeza manual**. Em caso de rede offline, usar dados locais com indicação clara de possível desatualização.
5. Confirmar: datas nunca consultadas não têm indicador de *sem cardápio*; resultado vazio da FUMP marca ausência temporária, sem inventar refeições.
6. Confirmar CORS em `hubufmg.web.app` e `hubufmg.firebaseapp.com`; origem arbitrária recebe 403.
7. Monitorar consumo no painel Cloudflare: Free tem teto de requisições diárias.

## Caching e riscos
- O cache local do Worker (`caches.default`) não é global; a configuração `[cache] enabled = true` usa tiered Workers Cache, compartilhando fills entre datacenters sem KV.
- `[placement] region = "gcp:southamerica-east1"` posiciona processamento perto da FUMP. Validar em produção: o comportamento real da origem pode mudar e a configuração é reversível.
- Respostas 200 com pratos possuem `max-age=240` e **`stale-if-error=1800`**, preservando no máximo 30 minutos adicionais diante de erro upstream para cada cache existente. Resposta sem pratos tem `stale-if-error=0`, porque vazio não significa RU fechado.
- Respostas de erro são `no-store`. `Vary: Origin` evita mistura de cabeçalhos CORS. O navegador identifica `CF-Cache-Status: STALE` e exibe aviso de contingência; `X-Menu-Fetched-At` preserva data da coleta original.
- A origem da FUMP é externa e pode cair, mudar esquema, bloquear Cloudflare ou não publicar cardápios. Nenhum plano gratuito garante operação perpétua ou disponibilidade absoluta. Cardápios nunca são inventados.
- Limites do Workers Free, mudanças de contrato dos provedores e credenciais/deploy de novas versões continuam sendo riscos operacionais.

## GitHub Actions
- Cron de cardápios principal, redundante, legado e watchdog desligados; preserva `workflow_dispatch` para operações administrativas conscientes.
- Os workflows de **sorteio** e **OCUPA QA** não são parte desta mudança.
- Deploy automático do Hosting por GitHub está desativado por padrão porque a conta de serviço WIF não possui permissões suficientes. Para voltar a ativá-lo, corrigir IAM, validar e então definir `HUB_HOSTING_AUTO_DEPLOY_ENABLED=true` no GitHub.
- Os testes automatizados de regressão continuam funcionando em push/PR, sem acesso de escrita ao Firestore.

## Fontes
- https://developers.cloudflare.com/workers/configuration/placement/
- https://developers.cloudflare.com/workers/cache/
- https://developers.cloudflare.com/workers/platform/limits/
