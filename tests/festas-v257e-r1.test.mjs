import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const festas=fs.readFileSync('public/assets/festas.js','utf8');
const backend=fs.readFileSync('public/assets/festas-backend.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');

test('R1: cartaz tem diagnóstico de carregamento/falha e gravação separada',()=>{
  assert.match(festas,/Carregando cartaz/);
  assert.match(festas,/Cartaz não encontrado/);
  assert.match(festas,/eventPosters/);
  assert.match(festas,/festa-poster-fallback/);
});

test('R1: salvar festa usa modal de resultado e bloqueia botão durante commit',()=>{
  assert.match(html,/admin-save-dialog/);
  assert.match(festas,/Salvando…/);
  assert.match(festas,/showSaveResult\(true/);
  assert.match(festas,/showSaveResult\(false/);
  assert.match(festas,/await batch\.commit\(\)/);
});

test('R1: participantes alternativos usam Auth anônimo independente',()=>{
  assert.match(backend,/participantAuths/);
  assert.match(backend,/bandeco-participant-\$\{index\+1\}/);
  assert.match(backend,/indexedDBLocalPersistence/);
  assert.match(html,/Inscrever outra pessoa/);
  assert.match(festas,/participant-slot/);
  assert.match(festas,/events',state\.selected\.id,'entries',uid/);
});

test('R1: encerramento continua sob autoridade do servidor',()=>{
  assert.match(rules,/request\.time < resource\.data\.drawAtTimestamp/);
  assert.match(rules,/request\.time < get\(eventPath\(eventId\)\)\.data\.drawAtTimestamp/);
  assert.match(festas,/Inscrições encerradas · aguardando apuração/);
  assert.match(festas,/visibilitychange/);
});
