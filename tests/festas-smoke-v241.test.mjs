import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../scripts/test-festas-local.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/assets/styles.css',import.meta.url),'utf8');

test('E2E seleciona as quatro abas sem contar o controle desktop',()=>{
  assert.match(source, /\.bandeco-tabs > button\[aria-controls\]/);
  assert.match(source, /\['tab-menu','tab-interno','tab-festas','tab-sobre'\]/);
  assert.match(source, /page\.locator\('#sidebar-collapse'\)\.isVisible\(\),false/);
  assert.doesNotMatch(source, /page\.locator\('\.bandeco-tabs button'\)\.count\(\)/);
  for(const id of ['tab-menu','tab-festas','tab-interno','tab-sobre']){
    assert.match(html,new RegExp('id="'+id+'"[^>]*aria-controls='));
  }
  assert.match(html,/class="sidebar-collapse" id="sidebar-collapse"/);
  assert.match(css, /@media \(max-width:850px\)/);
  assert.match(css, /\.sidebar-brand,\.sidebar-footer\{display:none!important\}/);
});
