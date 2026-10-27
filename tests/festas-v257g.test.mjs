import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const festas=fs.readFileSync('public/assets/festas.js','utf8');
const backend=fs.readFileSync('public/assets/festas-backend.js','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');
const qaRunner=fs.readFileSync('scripts/run-raffles-qa.mjs','utf8');

test('G: Auth e Firestore usam o mesmo slot de participante',()=>{
  assert.match(backend,/participantDbs=participantApps\.map/);
  assert.match(backend,/cached=\{auth:participantAuths\[0\],participantAuths,participantDbs/);
  assert.match(festas,/function participantDb\(svc\)/);
  assert.match(festas,/const db=participantDb\(svc\)/);
});

test('G: troca exige confirmação, aguarda signOut e rejeita UID repetido',()=>{
  assert.match(html,/Inscrever outra pessoa\?/);assert.match(html,/A inscrição anterior continuará registrada/);
  assert.match(festas,/waitForAuthState/);assert.match(festas,/signOut\(current\)/);assert.match(festas,/fresh\.uid===previousUid/);
  assert.match(festas,/participantGeneration/);assert.doesNotMatch(festas,/refreshToken/);
});

test('G: ocultação é separada e arquivamento QA preserva inscrições',()=>{
  assert.match(html,/admin-hidden-wrap/);assert.match(html,/Ocultas/);assert.match(html,/admin-archived-wrap/);
  assert.match(festas,/async function deleteEvent\(event\)/);assert.doesNotMatch(festas,/batch\.delete\(row\.ref\)/);assert.match(festas,/resultPrivate/);
  assert.doesNotMatch(festas,/participantCount===0&&e\.raffleStatus!==\'drawn\'/);assert.match(rules,/allow delete: if false/);
  assert.match(rules,/'archived'/);assert.match(rules,/request\.resource\.data\.archived is bool/);
});

test('G: resultados continuam exclusivos do executor e o QA permanece inerte sem gate',()=>{
  assert.match(html,/Resultado publicado pelo sistema/);assert.match(html,/A publicação dos resultados é realizada automaticamente/);
  assert.match(rules,/allow create, update, delete: if false/);assert.match(rules,/Publicação somente pelo executor privado/);
  assert.match(qaRunner,/TARGET_PROJECT='bandeco-homologacao'/);assert.match(qaRunner,/RU_FESTAS_QA_DRAW_ENABLED!==\'true\'/);assert.match(qaRunner,/old\.exists/);
});

test('G: executor QA usa ADC federado e não chave JSON',()=>{
  assert.match(qaRunner,/type!==\'external_account\'/);
  assert.match(qaRunner,/@google-cloud\/firestore/);
  assert.doesNotMatch(qaRunner,/firebase-admin/);
  assert.doesNotMatch(qaRunner,/cardapioufmg/);
  assert.match(qaRunner,/safeId/);
  assert.match(qaRunner,/TARGET_PROJECT_NUMBER='342397522942'/);
  assert.match(qaRunner,/TARGET_SERVICE_ACCOUNT='bandeco-qa-runner@bandeco-homologacao\.iam\.gserviceaccount\.com'/);
  assert.match(qaRunner,/service_account_impersonation_url/);
});
