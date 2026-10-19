import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSnapshots} from '../scripts/merge-snapshots.mjs';
const now = new Date('2026-10-19T15:30:00Z');
const makeMenu = (dish, fetchedAt = '2026-10-19T12:00:00Z') => ({items:[{name:dish},{name:'Arroz'},{name:'Feijão'},{name:'Salada'}],fetchedAt});
const snap = (date, rest, meal, menu, generatedAt = '2026-10-19T15:00:00Z') => ({schemaVersion:1,generatedAt,source:'https://fump.ufmg.br/cardapio-do-dia/',days:{[date]:{restaurants:{[rest]:{meals:{[meal]:menu},fetchedAt:menu.fetchedAt}}}}});
test('preserva cardápio de outro RU durante falha parcial',()=>{
  const old=snap('2026-10-19','setorial-i','almoco',makeMenu('Peixe'));
  const next=snap('2026-10-19','saude','jantar',makeMenu('Sopa','2026-10-19T15:00:00Z'));
  const merged=mergeSnapshots(old,next,now);
  assert.equal(merged.days['2026-10-19'].restaurants['setorial-i'].meals.almoco.items[0].name,'Peixe');
  assert.equal(merged.days['2026-10-19'].restaurants.saude.meals.jantar.items[0].name,'Sopa');
});
test('substitui menu oficialmente alterado mesmo com menos itens',()=>{
  const old=snap('2026-10-19','setorial-i','almoco',{items:[1,2,3,4,5,6].map(n=>({name:'Prato '+n})),fetchedAt:'2026-10-19T10:00:00Z'});
  const next=snap('2026-10-19','setorial-i','almoco',{items:[{name:'Novo prato'},{name:'Arroz'},{name:'Feijão'},{name:'Salada'}],fetchedAt:'2026-10-19T13:00:00Z'});
  const merged=mergeSnapshots(old,next,now);
  assert.equal(merged.days['2026-10-19'].restaurants['setorial-i'].meals.almoco.items.length,4);
  assert.equal(merged.days['2026-10-19'].restaurants['setorial-i'].meals.almoco.items[0].name,'Novo prato');
});
test('rejeita retrocesso para captura antiga',()=>{
  const old=snap('2026-10-19','setorial-i','almoco',makeMenu('Atual','2026-10-19T15:00:00Z'));
  const next=snap('2026-10-19','setorial-i','almoco',makeMenu('Antigo','2026-10-19T09:00:00Z'));
  assert.equal(mergeSnapshots(old,next,now).days['2026-10-19'].restaurants['setorial-i'].meals.almoco.items[0].name,'Atual');
});
test('remove dias além da janela de retenção e valida formato',()=>{
  const old=snap('2026-09-01','setorial-i','almoco',makeMenu('Antigo'));
  const next=snap('2026-10-19','saude','almoco',makeMenu('Novo'));
  const x=mergeSnapshots(old,next,now);
  assert.equal(x.days['2026-09-01'],undefined);
  assert.ok(x.days['2026-10-19']);
  assert.throws(()=>mergeSnapshots(null,{},now));
});
