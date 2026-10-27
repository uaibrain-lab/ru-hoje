import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
test('cartões exibem ingresso e tags, mas não vagas nem suplentes publicamente',()=>{
 const html=src('public/index.html'),script=src('public/assets/festas.js');
 assert.match(script,/INGRESSOS 🔥/);assert.match(script,/normalizeTags\(e\.tags\)/);
 const section=script.slice(script.indexOf('function renderEvents()'),script.indexOf('function setSignupStep'));
 assert.doesNotMatch(section,/e\.winnerCount/);assert.doesNotMatch(section,/e\.alternateCount/);
 assert.match(html,/id="admin-winnerCount"/);assert.doesNotMatch(html,/não limita inscrições/);
});
test('demo local e inscrição real sem enumeração, marketing opt-in',()=>{
 const code=src('public/assets/festas.js'),html=src('public/index.html');
 assert.match(code,/\['localhost','127\.0\.0\.1'\]/);
 assert.match(code,/authMod.signInAnonymously/);assert.match(code,/encryptPrivate/);
 assert.match(code,/demoProfiles\.has\(ig\)/);
 assert.match(html,/id="signup-marketing" type="checkbox"/);
 assert.match(code,/\$\('signup-marketing'\)\.checked=false/);
});
test('administrador mantém exportação protegida e exclusão somente após validação',()=>{
 const html=src('public/index.html'),code=src('public/assets/festas.js');
 for(const id of ['admin-tab-events','admin-tab-forms','admin-export-csv','admin-delete-all','admin-poster-file','admin-drawAt','admin-rulesText'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(code,/function exportCSV\(\)\{if\(!state\.admin\)/);
 assert.match(code,/function deleteAll\(\)\{if\(!DEMO\|\|!state\.admin\)/);
 assert.match(code,/setInterval\(demoScheduler,1000\)/);
});
