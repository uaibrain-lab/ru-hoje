import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entryFromDoc,entriesSnapshotHash,eventFingerprint,
  assertRaffleSnapshotUnchanged,publishRaffleAtomically
} from '../scripts/raffle-publication-guard.mjs';

const at=Date.parse('2026-11-17T12:00:00Z');
const event=Object.freeze({
  raffleStatus:'open',published:true,archived:false,
  drawAtTimestamp:new Date(at-60_000),winnerCount:2,alternateCount:1,
  participantCount:2,rulesText:'Regras públicas'
});
const entry=(uid,token)=>({
  uid,createdAt:'2026-11-17T11:00:00.000Z',
  encryptedProfile:{version:1,ciphertext:token}
});
const entries=[entry('u1','aa'),entry('u2','bb')];
const doc=entry=>({
  id:entry.uid,
  data:()=>({
    encryptedProfile:entry.encryptedProfile,
    createdAt:{toDate:()=>new Date(entry.createdAt)}
  })
});
const field={serverTimestamp:()=>({serverTime:true})};
const pub={status:'published',eligibleCount:2,winners:[{mask:'Pessoa P.'}],alternates:[]};
const priv={winnerUids:['u1'],alternateUids:[],eligibleCount:2};

function harness({currentEvent=event,currentEntries=entries,publicExists=false,privateExists=false,exists=true}={}){
  const reads=[],writes=[];
  const ref={
    tag:'event',
    collection:(name)=>name==='entries'
      ? {tag:'entries',docs:()=>null}
      : {tag:name,doc:id=>({tag:name,id})}
  };
  const tx={
    async get(target){
      reads.push(target.tag);
      if(writes.length)throw new Error('LEITURA_APOS_ESCRITA');
      switch(target.tag){
      case 'event':return {exists,data:()=>currentEvent};
      case 'results':return {exists:publicExists};
      case 'resultPrivate':return {exists:privateExists};
      case 'entries':return {docs:currentEntries.map(doc)};
      default:throw new Error('QUERY_DESCONHECIDA');
      }
    },
    create(ref,body){writes.push({action:'create',tag:ref.tag,body});},
    update(ref,body){writes.push({action:'update',tag:ref.tag,body});}
  };
  return {ref,reads,writes,db:{runTransaction:async fn=>fn(tx)}};
}
const apply=async (h,initialEvent=event,initialEntries=entries)=>
  publishRaffleAtomically({db:h.db,eventRef:h.ref,event:initialEvent,entries:initialEntries,
    publicResult:pub,privateResult:priv,FieldValue:field,nowFn:()=>at});

test('inscrições de snapshot em ordem diferente têm mesmo SHA256; qualquer edição altera hash',()=>{
  assert.equal(entriesSnapshotHash(entries),entriesSnapshotHash(entries.toReversed()));
  assert.notEqual(entriesSnapshotHash(entries),entriesSnapshotHash([entry('u1','aa'),entry('u2','xx')]));
  assert.notEqual(entriesSnapshotHash(entries),entriesSnapshotHash([entry('u1','aa'),entry('u3','bb')]));
});

test('parâmetros de resultado e prazo fazem parte do fingerprint',()=>{
  for(const changed of [
    {...event,winnerCount:1},{...event,alternateCount:2},
    {...event,participantCount:3},{...event,drawAtTimestamp:new Date(at+50_000)},
    {...event,raffleStatus:'closed'},{...event,published:false},
    {...event,archived:true},{...event,rulesText:'alterada'}
  ])assert.notEqual(eventFingerprint(event),eventFingerprint(changed));
});

test('em estado estável, lê tudo antes de publicar somente os 3 documentos atômicos',async()=>{
  const h=harness();
  assert.equal(await apply(h),true);
  assert.deepEqual(h.reads,['event','results','resultPrivate','entries']);
  assert.deepEqual(h.writes.map(x=>x.action+':'+x.tag),[
    'create:results','create:resultPrivate','update:event'
  ]);
  assert.equal(h.writes[2].body.raffleStatus,'drawn');
  assert.deepEqual(h.writes[0].body.winners,pub.winners);
});

test('idempotência: resultado público e privado já publicados não reexecutam apuração',async()=>{
  const h=harness({publicExists:true,privateExists:true});
  assert.equal(await apply(h),false);
  assert.deepEqual(h.writes,[]);
  assert.ok(!h.reads.includes('entries'));
});

test('inconsistência parcial pré-existente falha em vez de inventar resultado substituto',async()=>{
  for(const cases of [
    {publicExists:true,privateExists:false},
    {publicExists:false,privateExists:true}
  ]){
    const h=harness(cases);
    await assert.rejects(()=>apply(h),/RESULTADO_PARCIAL_PREEXISTENTE/);
    assert.deepEqual(h.writes,[]);
  }
});

test('vencedores não são publicados se a inscrição mudou mas contagem ficou igual',async()=>{
  const h=harness({currentEntries:[entry('u1','aa'),entry('u2','changed')]});
  await assert.rejects(()=>apply(h),/INSCRICOES_ALTERADAS_DURANTE_APURACAO/);
  assert.deepEqual(h.writes,[]);
});

test('resultado não é publicado se o número de ganhadores mudou durante descriptografia',async()=>{
  const h=harness({currentEvent:{...event,winnerCount:1}});
  await assert.rejects(()=>apply(h),/EVENTO_ALTERADO_DURANTE_APURACAO/);
  assert.deepEqual(h.writes,[]);
});

test('resultado não é publicado se evento adiado, arquivado ou não publicado',async()=>{
  for(const changed of [
    {...event,drawAtTimestamp:new Date(at+3_600_000)},
    {...event,published:false},
    {...event,archived:true}
  ]){
    const h=harness({currentEvent:changed});
    await assert.rejects(()=>apply(h),/EVENTO_ALTERADO_DURANTE_APURACAO/);
    assert.deepEqual(h.writes,[]);
  }
});

test('contagem divergente e evento inexistente não deixam escrita parcial',async()=>{
  const a=harness({currentEntries:entries.slice(0,1)});
  await assert.rejects(()=>apply(a),/CONTAGEM_INSCRICOES_DIVERGENTE/);
  assert.deepEqual(a.writes,[]);
  const b=harness({exists:false});
  await assert.rejects(()=>apply(b),/EVENTO_REMOVIDO/);
  assert.deepEqual(b.writes,[]);
});

test('query de entries readback preserva horário original e dados cifrados',()=>{
  assert.deepEqual(entryFromDoc(doc(entries[0])),entries[0]);
  assert.equal(assertRaffleSnapshotUnchanged({initialEvent:event,latestEvent:event,
    initialEntries:entries,latestEntries:entries,now:at}),true);
});
