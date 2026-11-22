import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('public/index.html',root),'utf8');
const css=readFileSync(new URL('public/assets/styles.css',root),'utf8');

test('Festas tem título visível e introdução clara',()=>{
  assert.match(html,/<header class="festas-section-header">[\s\S]*?<h2 id="festas-heading">Festas<\/h2>/);
  assert.doesNotMatch(html,/<h2 id="festas-heading" class="sr-only">/);
  assert.match(css,/\.festas-section-header h2/);
});
test('Sobre tem três seções com títulos reais sem cortar o texto',()=>{
  const sections=[...html.matchAll(/<section class="sobre-topic" aria-labelledby="([^"]+)">/g)];
  assert.deepEqual(sections.map(x=>x[1]),['sobre-quem','sobre-lazer','sobre-aberta']);
  for(const id of sections.map(x=>x[1]))assert.match(html,new RegExp('<h3 id="'+id+'">'));
  for(const h of ['Quem somos','O lazer como direito','Por uma universidade aberta'])assert.ok(html.includes(h));
  assert.match(css,/\.sobre-content\s*\{\s*display:grid/);
  assert.match(css,/\.sobre-content \.sobre-topic p/);
});
test('Cardápio Festas Sobre usam tokens, foco e movimento reduzido',()=>{
  for(const token of ['--ui-space-2','--ui-space-4','--ui-space-5','--ui-radius-card','--ui-radius-control'])
    assert.ok(css.includes(token));
  assert.match(css,/#bandeco-main \.menu-disclaimer p/);
  assert.match(css,/#bandeco-main \.date-strip\{scroll-snap-type/);
  assert.match(css,/\.festa-poster-trigger:focus-visible/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.sobre-topic\s*\{/);
});
test('Sem perda de abas, seletor do RU e instalação PWA',()=>{
  for(const id of ['tab-menu','tab-interno','tab-festas','tab-sobre','restaurant-trigger',
                   'date-strip','meal-list','festas-list','sobre-page','interno-frame',
                   'pwa-install-manual'])
    assert.ok(html.includes('id="'+id+'"'),'Faltou '+id);
});
