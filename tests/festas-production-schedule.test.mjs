import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('sorteio de producao roda agendado e manualmente no MESMO workflow autenticado',()=>{
 const y=load('.github/workflows/hub-production-raffles.yml');
 assert.match(y,/schedule:\s*\n\s*- cron: '7,17,27,37,47,57 \* \* \* \*'/);
 assert.match(y,/workflow_dispatch:/);
 assert.match(y,/vars.HUB_PROD_RAFFLES_ENABLED == 'true'/);
 assert.match(y,/HUB_PROD_PRIVATE_KEY_JWK: \${{ secrets.HUB_PROD_PRIVATE_KEY_JWK }}/);
 assert.match(y,/hub-prod-raffles@hubufmg\.iam\.gserviceaccount\.com/);
 assert.match(y,/group: hub-production-raffles/);
 assert.match(load('scripts/run-raffles-production.mjs'),/prepareRaffle/);
});
test('watchdog detecta atraso de 35 minutos e recupera pelo workflow homologado',()=>{
 const yaml=load('.github/workflows/hub-production-raffle-watchdog.yml');
 const sh=load('scripts/hub-production-raffle-watchdog.sh');
 assert.match(yaml,/cron: '4,24,44 \* \* \* \*'/);
 assert.match(yaml,/actions: write/);
 assert.match(yaml,/issues: write/);
 assert.match(sh,/35 \* 60/);
 assert.match(sh,/gh workflow run "\$workflow"/);
 assert.match(sh,/HUB_PROD_RAFFLES_ENABLED/);
 assert.match(sh,/HUB_INCIDENT_LABEL=sorteios-agendados/);
 assert.doesNotMatch(sh,/PRIVATE_KEY_JWK|encryptedProfile|resultPrivate/);
});
test('modal publico nao menciona painel restrito e nomes seguem mascarados',()=>{
 const html=load('public/index.html');
 const policy=load('public/privacidade-festas.html');
 const engine=load('scripts/raffle-engine.mjs');
 assert.doesNotMatch(html,/Nomes parcialmente censurados; dados completos apenas no painel restrito/);
 assert.doesNotMatch(policy,/O acesso administrativo é restrito/);
 assert.match(engine,/maskName\(name\)/);
 assert.match(html,/id="result-body"/);
});
test('recuperação de chave não está ligada a workflow público nem substitui chaves existentes',()=>{
 const prep=load('scripts/festas-recovery-prepare.mjs');
 const dec=load('scripts/festas-recovery-decrypt.mjs');
 const ignore=load('.gitignore');
 assert.match(prep,/flag:'wx'/);
 assert.match(dec,/flag:'wx'/);
 assert.match(prep,/Documents/);
 assert.match(ignore,/private\//);
 assert.doesNotMatch(load('.github/workflows/hub-production-raffles.yml'),/recovery|recover|artifact/);
});
