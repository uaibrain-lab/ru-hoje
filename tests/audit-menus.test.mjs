import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSnapshot} from '../scripts/audit-menus.mjs';
const menu = (ru='setorial-i',meal='almoco',items=['Arroz branco','Feijão carioca','Frango grelhado','Salada de alface'])=>({
  schemaVersion:1,days:{'2026-10-19':{restaurants:{[ru]:{meals:{[meal]:{items:items.map(name=>({name}))}}}}}}
});
test('permite um cardápio não contaminado (mas não o declara validado contra a FUMP)',()=>{
  assert.deepEqual(auditSnapshot(menu()),[]);
});
test('barra termos conhecidos do banner de cookies',()=>{
  assert.match(auditSnapshot(menu('setorial-i','almoco',['Arroz branco','Valorizamos sua privacidade','Feijão carioca']))[0],/contaminado/);
});
test('barra jantar do Setorial II que não serve jantar regular',()=>{
  assert.match(auditSnapshot(menu('setorial-ii','jantar'))[0],/não serve jantar/);
});
test('barra esquema quebrado ou conteúdo vazio',()=>{
  assert.deepEqual(auditSnapshot({schemaVersion:1}),['Schema inválido']);
  assert.ok(auditSnapshot(menu('saude','almoco',[])).some(s=>s.includes('sem itens')));
});
