import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrefetchPlan,canRunBackgroundFetch,recentlyChecked,nextIso,
  PREFETCH_LIMIT_PER_DAY,PREFETCH_TTL_MS} from '../public/assets/fump-prefetch.js';

const today='2026-11-16';
const tomorrow='2026-11-17';

test('prioriza próximos cinco dias do RU escolhido antes dos outros RUs',()=>{
  const plan=buildPrefetchPlan('setorial-i',today);
  assert.equal(plan.length,PREFETCH_LIMIT_PER_DAY);
  assert.deepEqual(plan.slice(0,5).map(x=>[x.sourceId,x.iso]),[
    ['6','2026-11-17'],['6','2026-11-18'],['6','2026-11-19'],
    ['6','2026-11-20'],['6','2026-11-21']
  ]);
  assert.deepEqual(plan.slice(5,8).map(x=>x.sourceId),['1','2','5']);
  assert.ok(plan.slice(8).every(x=>x.iso>today));
});

test('Saúde e Direito compartilham ID 2 e o plano não repete fonte/data',()=>{
  const plan=buildPrefetchPlan('direito',today);
  const keys=plan.map(x=>x.key);
  assert.equal(keys.length,new Set(keys).size);
  assert.ok(plan.every(x=>x.ruId!=='direito' || x.iso!==today));
  assert.ok(plan.every(x=>x.sourceId!=='2' || x.ruId==='direito'));
});

test('não prefetch dias além do limite visível nem inventa datas inválidas',()=>{
  assert.deepEqual(buildPrefetchPlan('ica',today,{maxDate:today}).map(x=>x.iso),[today,today,today]);
  assert.deepEqual(buildPrefetchPlan('ica',today,{maxDate:tomorrow,futureDays:7,otherFutureDays:5}).map(x=>x.iso),
    [tomorrow,today,today,today,tomorrow,tomorrow,tomorrow]);
  assert.equal(nextIso('2026-12-31',1),'2027-01-01');
  assert.throws(()=>nextIso('2026-02-31',1));
});

test('nunca consulta fonte ou data desconhecida',()=>{
 assert.deepEqual(buildPrefetchPlan('invalid',today),[]);
 assert.deepEqual(buildPrefetchPlan('setorial-i','2026-02-31'),[]);
 assert.deepEqual(buildPrefetchPlan('setorial-i',today,{limit:0}),[]);
});

test('respeita rede lenta, economia de dados, desconexão e aba invisível',()=>{
 assert.equal(canRunBackgroundFetch({online:false}),false);
 assert.equal(canRunBackgroundFetch({visible:false}),false);
 assert.equal(canRunBackgroundFetch({connection:{saveData:true}}),false);
 assert.equal(canRunBackgroundFetch({connection:{effectiveType:'2g'}}),false);
 assert.equal(canRunBackgroundFetch({connection:{effectiveType:'slow-2g'}}),false);
 assert.equal(canRunBackgroundFetch({connection:{effectiveType:'4g'}}),true);
 assert.equal(canRunBackgroundFetch({}),true);
});

test('cache mantém TTL positivo sem bloquear eternamente cardápios novos',()=>{
 const now=Date.parse('2026-11-16T14:00:00Z');
 assert.equal(recentlyChecked({status:'VALID_MENU',at:now-10*60_000},now),true);
 assert.equal(recentlyChecked({status:'VALID_MENU',at:now-PREFETCH_TTL_MS.VALID_MENU-1},now),false);
 assert.equal(recentlyChecked({status:'NOT_PUBLISHED',at:now-15*60_000},now),true);
 assert.equal(recentlyChecked({status:'NOT_PUBLISHED',at:now-25*60_000},now),false);
 assert.equal(recentlyChecked({status:'FETCH_ERROR',at:now-11*60_000},now),false);
 assert.equal(recentlyChecked({status:'not-in-map',at:now},now),false);
 assert.equal(recentlyChecked({status:'VALID_MENU',at:now+60_000},now),false);
 assert.equal(recentlyChecked(null,now),false);
});
