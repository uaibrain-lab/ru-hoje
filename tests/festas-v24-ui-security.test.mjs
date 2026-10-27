import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const get=(name)=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('desktop com sidebar recolhível e mobile com rodapé de 4 abas',()=>{
  const css=get('public/assets/styles.css'),html=get('public/index.html');
  assert.match(css,/min-width:851px/);assert.match(css,/\.bandeco-tabs\.is-collapsed/);
  assert.match(css,/max-width:850px/);
  assert.match(html,/id="sidebar-collapse"/);
  for(const id of ['tab-menu','tab-festas','tab-interno','tab-sobre'])assert.match(html,new RegExp(`id="${id}"`));
});
test('cadeado fica escondido até 5 cliques da foto, sem funcionar como permissão',()=>{
  const js=get('public/assets/festas.js'),html=get('public/index.html'),rules=get('firestore.rules');
  assert.match(html,/<button id="admin-lock"[^>]*hidden>/);
  assert.match(js,/if\(taps===5\)/);assert.match(js,/portrait\?\.addEventListener\('click'/);
  assert.match(rules,/documents\/eventAdminAccess\/owner/);
  assert.match(rules,/get\(adminPath\(\)\)\.data\.uid == request.auth.uid/);
  assert.match(rules,/allow list, create, update, delete: if false/);
});
test('inscrições precisam de sessão anônima, contador transacional e horário no servidor',()=>{
  const js=get('public/assets/festas.js'),rules=get('firestore.rules');
  assert.match(js,/authMod.signInAnonymously/);assert.match(js,/dbMod.runTransaction/);
  assert.match(js,/encryptPrivate/);assert.match(rules,/request.time < resource.data.drawAtTimestamp/);
  assert.match(rules,/encrypted.ciphertext/);
});
test('execução de sorteios não roda sem liberação, mesmo após GitHub push',()=>{
  const exec=get('scripts/run-raffles.mjs'),workflow=get('.github/workflows/festas-apuracao.yml');
  assert.match(exec,/RU_FESTAS_DRAW_ENABLED/);assert.match(exec,/RU_FESTAS_PROJECT_ID/);
  assert.match(workflow,/if: vars.RU_FESTAS_DRAW_ENABLED == 'true'/);
  assert.match(workflow,/secrets.RU_FESTAS_PRIVATE_KEY_JWK/);
});
