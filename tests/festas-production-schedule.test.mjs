import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('sorteio de producao roda agendado e manualmente no MESMO workflow autenticado',()=>{
 const y=load('.github/workflows/hub-production-raffles.yml');
 assert.match(y,/schedule:\s*\n\s*- cron: '10 21 \* \* 3-5'/);
 assert.match(y,/workflow_dispatch:/);
 assert.match(y,/vars.HUB_PROD_RAFFLES_ENABLED == 'true'/);
 assert.match(y,/HUB_PROD_PRIVATE_KEY_JWK: \${{ secrets.HUB_PROD_PRIVATE_KEY_JWK }}/);
 assert.match(y,/hub-prod-raffles@hubufmg\.iam\.gserviceaccount\.com/);
 assert.match(y,/group: hub-production-raffles/);
 assert.match(y,/github.ref == 'refs\/heads\/main'/);
 assert.match(load('scripts/run-raffles-production.mjs'),/prepareRaffle/);
});
test('sem watchdog que execute sorteios fora do horário',()=>{
 assert.equal(existsSync(new URL('../.github/workflows/hub-production-raffle-watchdog.yml',import.meta.url)),false);
 assert.equal(existsSync(new URL('../scripts/hub-production-raffle-watchdog.sh',import.meta.url)),false);
 const runner=load('scripts/run-raffles-production.mjs');
 const core=load('scripts/raffle-engine.mjs');
 assert.match(runner,/isScheduledRaffleWindow/);
 assert.match(runner,/where\('raffleStatus','in',\['open','closed'\]\)/);
 assert.match(core,/timestamp<=now/);
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

test('workflows legados e QA não agendam apuração em horários adicionais',()=>{
 for(const path of ['.github/workflows/festas-apuracao.yml','.github/workflows/festas-apuracao-qa.yml']){
   const yaml=load(path);
   assert.match(yaml,/workflow_dispatch:/);
   assert.doesNotMatch(yaml,/\bschedule:/);
 }
});
