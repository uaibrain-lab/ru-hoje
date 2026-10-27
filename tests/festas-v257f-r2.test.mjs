import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const festas=fs.readFileSync('public/assets/festas.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');

test('F-R2 começa pelo gerenciador em lista e não carrega a última festa automaticamente',()=>{
  assert.match(html,/admin-events-list/); assert.match(html,/admin-create-event/); assert.match(html,/admin-back-list/);
  assert.match(festas,/editorMode:'list'/); assert.match(festas,/setEditorVisible\(false\)/); assert.match(festas,/function openCreate\(\)/);
});

test('F-R2 oferece ações visíveis, olhos de visibilidade e lixeira QA segura',()=>{
  assert.match(festas,/visibilityIcon\(visible\)/); assert.match(festas,/trashIcon\(\)/); assert.match(festas,/Ocultar festa/); assert.match(festas,/Exibir festa/);
  assert.match(festas,/async function deleteEvent/); assert.match(festas,/results.*official/); assert.match(rules,/allow delete: if false/); assert.match(html,/id="admin-hidden-wrap"/); assert.match(html,/Ocultas/); assert.match(html,/Duplicar para novo teste/);
});

test('F-R2 não expõe diagnóstico técnico de cartaz na área pública',()=>{
  assert.doesNotMatch(festas,/Cartaz carregado\./); assert.match(html,/festa-save-result/); assert.match(html,/aria-modal="true"/);
  assert.doesNotMatch(festas,/\b(?:alert|confirm)\s*\(/);
});

test('F-R2 mantém a troca de participante independente e o fechamento sob relógio do servidor',()=>{
  assert.match(html,/Inscrever outra pessoa/); assert.match(festas,/participantSlot/); assert.match(rules,/request\.time < get\(eventPath\(eventId\)\)\.data\.drawAtTimestamp/);
});
