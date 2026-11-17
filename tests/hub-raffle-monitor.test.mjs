import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateRaffleMonitor} from '../scripts/raffle-monitor-policy.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const now=Date.parse('2026-11-18T22:15:00.000Z'); // Qua, 19h15 em Brasília
const scheduled=(changes={})=>({
  id:17,event:'schedule',head_branch:'main',status:'completed',conclusion:'success',
  created_at:'2026-11-18T21:16:00Z',...changes
});

test('monitor não cria incidentes quando sorteios estão desabilitados',()=>{
  assert.deepEqual(evaluateRaffleMonitor([],{enabled:false,now}),{status:'DISABLED',runId:null});
  const sh=read('scripts/hub-production-raffle-alert.sh');
  assert.match(sh,/HUB_PROD_RAFFLES_ENABLED:-false/);
  assert.match(sh,/SORTEIOS_DESABILITADOS/);
  assert.match(read('.github/workflows/hub-production-raffle-alert.yml'),
    /HUB_PROD_RAFFLES_ENABLED: \$\{\{ vars\.HUB_PROD_RAFFLES_ENABLED \|\| 'false' \}\}/);
});

test('monitor aceita apenas sucesso agendado na main dentro das últimas 2 horas',()=>{
  const good=evaluateRaffleMonitor([scheduled()],{enabled:true,now});
  assert.deepEqual(good,{status:'SUCCESS',runId:17});
  const invalid=[
    scheduled({event:'workflow_dispatch'}),
    scheduled({head_branch:'feature'}),
    scheduled({created_at:'2026-11-18T19:10:00Z'}),
    scheduled({status:'completed',conclusion:'skipped'}),
    scheduled({status:'completed',conclusion:'failure'})
  ];
  assert.equal(evaluateRaffleMonitor(invalid,{enabled:true,now}).status,'MISSING_OR_FAILED');
});

test('monitor tolera execução ainda pendente às 19h15, mas alerta às 19h45',()=>{
  const delayed=scheduled({id:22,status:'in_progress',conclusion:null,created_at:'2026-11-18T21:45:00Z'});
  assert.deepEqual(evaluateRaffleMonitor([delayed],{enabled:true,now}),{status:'PENDING',runId:22});
  assert.equal(evaluateRaffleMonitor([delayed],{
    enabled:true,now:Date.parse('2026-11-18T22:45:00Z')
  }).status,'MISSING_OR_FAILED');
  const yaml=read('.github/workflows/hub-production-raffle-alert.yml');
  assert.match(yaml,/cron: '15 22 \* \* 3-5'/);
  assert.match(yaml,/cron: '45 22 \* \* 3-5'/);
  assert.doesNotMatch(yaml,/id-token: write|PRIVATE_KEY_JWK/);
});

test('monitor malformado falha fechado e não executa sorteios',()=>{
  assert.equal(evaluateRaffleMonitor(null,{enabled:true,now}).status,'INVALID_INPUT');
  assert.equal(evaluateRaffleMonitor([scheduled()],{enabled:true,now:NaN}).status,'INVALID_INPUT');
  const bash=read('scripts/hub-production-raffle-alert.sh');
  assert.doesNotMatch(bash,/gh workflow run|run-raffles-production|--commit|PRIVATE_KEY_JWK|workflow_dispatch/);
  assert.match(bash,/node scripts\/raffle-monitor-policy\.mjs/);
});
