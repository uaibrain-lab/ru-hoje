import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const e2e=readFileSync(new URL('../scripts/test-festas-local.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
test('primeira visita escolhe RU antes de abrir a aba Festas, sem contornar o modal',()=>{
  assert.match(html, /<dialog[^>]*id="restaurant-dialog"/);
  const visible=e2e.indexOf("restaurantDialog.waitFor({state:'visible'");
  const choose=e2e.indexOf("getByRole('button',{name:'RU Setorial I Campus Pampulha',exact:true}).click()");
  const closed=e2e.indexOf("restaurantDialog.waitFor({state:'hidden'});");
  const festas=e2e.indexOf("page.locator('#tab-festas').click()");
  assert.ok(visible!==-1 && visible<choose && choose<closed && closed<festas);
  assert.doesNotMatch(e2e, /force\s*:\s*true/);
  assert.doesNotMatch(e2e, /document\.querySelector\('#restaurant-dialog'\)\.close\(/);
});
