import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=new URL('../',import.meta.url);
const get=p=>fs.readFileSync(new URL(p,root),'utf8');
const app=get('public/assets/app.js');
const index=get('public/index.html');
const sw=get('public/service-worker.js');
test('nome do projeto e rodapé corretos',()=>{
  assert.match(index,/<title>OCUPA UFMG<\/title>/);
  assert.doesNotMatch(index,/>RU Hoje</);
  assert.match(index,/instagram.com\/catmufmg/);
  assert.match(index,/fump.ufmg.br\/cardapio-do-dia/);
});
test('14 dias futuros a partir de hoje, sem dias anteriores',()=>{
  assert.match(app,/for \(let offset = 0; offset < 15; offset\+\+\)/);
  assert.match(app,/dateStrip.scrollLeft = 0/);
});
test('refresco continua exibido e categorias têm ícones',()=>{
  assert.match(app,/'Bebidas':'🥤'/);
  assert.match(app,/'Saladas':'🥗'/);
  assert.match(app,/const GROUP_ORDER/);
  assert.doesNotMatch(app,/groupDisplayItems/);
});
test('temas automático, claro e escuro selecionáveis',()=>{
  for(const x of ['auto','light','dark']) assert.match(index,new RegExp('data-theme-option="'+x+'"'));
  assert.match(app,/prefers-color-scheme: dark/);
});
test('fotos reais locais para cinco RUs, inclusive saúde e direito distintos',()=>{
  for(const id of ['setorial-i','setorial-ii','direito','saude','ica']){
    assert.ok(fs.statSync(new URL('public/assets/restaurantes/'+id+'.webp',root)).size>1000);
    assert.ok(app.includes('/assets/restaurantes/'+id+'.webp'));
    assert.ok(sw.includes('/assets/restaurantes/'+id+'.webp'));
  }
});
