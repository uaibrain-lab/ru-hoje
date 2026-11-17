import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {due} from '../scripts/raffle-engine.mjs';
import {assertPreparedRaffleResult,entriesSnapshotHash} from '../scripts/raffle-publication-guard.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('sorteio só pode ser apurado após o prazo oficial encerrar inscrições',()=>{
  const draw=Date.parse('2026-11-18T21:10:00Z');
  const e={raffleStatus:'open',published:true,archived:false,winnerCount:1,
    drawAtTimestamp:new Date(draw)};
  assert.equal(due(e,draw-1),false);
  assert.equal(due(e,draw),true);
  assert.equal(due({...e,drawAtTimestamp:new Date(draw+1)},draw),false);
  assert.equal(due({...e,raffleStatus:'disabled'},draw),false);
  const rules=read('firestore.rules');
  assert.match(rules,/request\.time < resource\.data\.drawAtTimestamp/);
  assert.match(rules,/request\.time < get\(eventPath\(eventId\)\)\.data\.drawAtTimestamp/);
});

test('resultado preparado de verdade deve ter ganhador e hash do snapshot',()=>{
  const e={winnerCount:1,alternateCount:0};
  const entries=[{uid:'u1',createdAt:'2026-11-18',encryptedProfile:{version:1,ciphertext:'test'}}];
  const hash=entriesSnapshotHash(entries);
  const pub={status:'published',schemaVersion:2,participantCount:1,eligibleCount:1,
    winners:[{mask:'Pe•••'}],alternates:[],entriesSnapshotSha256:hash};
  const priv={schemaVersion:2,attemptedEntries:1,eligibleCount:1,invalidEntryCount:0,
    winnerUids:['u1'],alternateUids:[],entriesSnapshotSha256:hash};
  assert.equal(assertPreparedRaffleResult({event:e,entries,publicResult:pub,privateResult:priv}),true);
  assert.throws(()=>assertPreparedRaffleResult({event:e,entries,
    publicResult:{...pub,winners:[]},privateResult:priv}),/QUANTIDADE_GANHADORES_DIVERGENTE/);
});

test('nenhuma tarefa recorrente de backup; cópia Git fica sob demanda',()=>{
  assert.equal(existsSync(new URL('../scripts/HUB-BACKUP-AGENDAR.ps1',import.meta.url)),false);
  const deploy=read('scripts/HUB-BATCH-DEPLOY-VERIFICAR.ps1');
  const manual=read('scripts/HUB-BACKUP-GIT-LOCAL.ps1');
  assert.match(deploy,/if\(\$env:HUB_BACKUP_BEFORE_DEPLOY -eq "true"\)/);
  assert.match(deploy,/HUB-BACKUP-GIT-LOCAL\.ps1/);
  assert.match(manual,/bundle create \$bundle --all/);
  assert.doesNotMatch(deploy,/New-ScheduledTaskTrigger|Register-ScheduledTask/);

});
