import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../public/assets/festas.js',import.meta.url),'utf8');

test('logout invalida leituras, limpa cache e remove preview administrativo',()=>{
  const start=source.indexOf('async function clearAdminSession');
  const end=source.indexOf('\nasync function logoutAdmin',start);
  const block=source.slice(start,end);
  assert.match(block,/state\.posterReadGeneration\+\+/);
  assert.match(block,/state\.posterCache\.clear\(\)/);
  assert.match(block,/preview\.removeAttribute\('src'\)/);
  assert.match(block,/preview\.hidden=true/);
});

test('leitura assíncrona não reaplica cartaz depois do logout',()=>{
  const start=source.indexOf('async function paintPoster');
  const end=source.indexOf('\nasync function optimizePoster',start);
  const block=source.slice(start,end);
  assert.match(block,/const readGeneration=state\.posterReadGeneration/);
  assert.match(block,/readGeneration===state\.posterReadGeneration/);
  assert.match(block,/\(!adminRead \|\| state\.admin\)/);
});
