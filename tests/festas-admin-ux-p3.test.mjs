// Contratos estáticos da interface administrativa; integração real validada separadamente no Emulator.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../public/assets/festas.js',import.meta.url),'utf8');
const core=await import('../public/assets/festas-core.js');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');

test('link sem protocolo é transformado, link inseguro rejeitado',()=>{
  assert.equal(core.normalizeTicketUrl('sympla.com.br/meu-evento'), 'https://sympla.com.br/meu-evento');
  assert.equal(core.normalizeTicketUrl('http://www.instagram.com/festa'), 'https://www.instagram.com/festa');
  for(const value of ['javascript:alert(1)', 'data:text/html,x', 'https://usuario:senha@site.com', 'localhost:8080', 'https://example.com/aa bb'])
    assert.equal(core.normalizeTicketUrl(value),'',`Deveria rejeitar ${value}`);
  assert.match(html,/id="admin-ticketUrl"[^>]*type="text"/);
});
test('nova festa não herda campos desabilitados do editor concluído',()=>{
  assert.match(src,/function resetEditor\(\)[\s\S]*?\['raffleStatus','winnerCount','alternateCount','drawAt','rulesText','published'\][^;]*disabled=false/);
  assert.match(src,/const immutable=e\.raffleStatus==='drawn';[^\n]*\$\('admin-published'\)\.disabled=immutable/);
  assert.match(src,/use o ícone de olho na lista/);
});
test('ocultar e republicar usa transação e lida com evento legado',()=>{
  assert.match(src,/runTransaction\(adminDb,async tx=>/);
  assert.match(src,/Object\.hasOwn\(fresh,'archived'\)/);
  assert.match(src,/tx\.update\(ref,\{published:next,updatedAt:dbMod\.serverTimestamp\(\)\}\)/);
  assert.match(src,/Visibilidade .*no Firestore, mas a lista não pôde ser atualizada/);
  assert.match(rules,/resource\.data\.raffleStatus == 'drawn'[\s\S]*?changed\.hasOnly\(\['published','updatedAt'\]\)/);
});
test('arquivo continua protegido; lixeira é somente arquivo reversível',()=>{
  assert.match(src,/function askDeleteEvent\(/);
  assert.match(src,/if\(!isArchived\)actions\.append\(del\)/);
  assert.match(src,/Arquivar .*não exclui definitivamente/);
  assert.match(rules,/allow delete: if false;/);
  assert.match(src,/Festa arquivada no Firestore, mas a lista não pôde ser atualizada/);
  assert.match(src,/Festa restaurada em Ocultas/);
});
test('ação Apagar todos somente laboratório, nunca no painel real',()=>{
  assert.match(src,/\$\('admin-delete-all'\)\.hidden=!DEMO/);
  assert.match(src,/function deleteAll\(\)\{if\(!DEMO\|\|!state\.admin\)return;/);
});
