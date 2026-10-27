import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL('../'+name, import.meta.url),'utf8');

test('E2E Bandeco valida exclusivamente o modal de selecao do RU', () => {
  const smoke=read('scripts/smoke.mjs');
  const html=read('public/index.html');
  assert.match(smoke, /page\.locator\('#restaurant-dialog'\)\.evaluate\(e=>e\.open\)/);
  assert.doesNotMatch(smoke, /page\.locator\('dialog'\)/);
  for (const id of ['restaurant-dialog','signup-dialog','result-dialog','admin-dialog']) {
    assert.match(html,new RegExp(`<dialog[^>]*id="${id}"`));
  }
});
