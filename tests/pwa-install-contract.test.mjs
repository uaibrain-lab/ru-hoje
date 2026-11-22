import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('public/index.html');
const js = read('public/assets/pwa-install.js');
const css = read('public/assets/styles.css');
const sw = read('public/service-worker.js');
const manifest = JSON.parse(read('public/manifest.webmanifest'));

test('o Hub conserva sua instalabilidade e recebe o controlador do aviso', () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.match(html, /<script src="\/assets\/pwa-install\.js\?v=[^"]+" defer><\/script>/);
  assert.match(html, /id="pwa-install-toast"[^>]*hidden/);
  assert.match(html, /id="pwa-install-manual-wrap"[^>]*hidden/);
  assert.match(html, /id="pwa-install-guide"/);
  assert.match(css, /\.pwa-install-toast\[hidden\]/);
});

test('o controlador não solicita permissão de push e preserva ação nativa no clique', () => {
  assert.doesNotThrow(() => new Script(js));
  assert.match(js, /beforeinstallprompt/);
  assert.match(js, /event\.preventDefault\(\)/);
  assert.match(js, /await prompt\.prompt\(\)/);
  assert.match(js, /navigator\.standalone === true/);
  assert.match(js, /localStorage\.setItem\(CLOSED_KEY, '1'\)/);
  assert.doesNotMatch(js, /requestPermission|PushManager|Notification\.requestPermission/);
});

test('o novo controlador é pré-cacheado e as versões de atualização coincidem', () => {
  assert.match(sw, /'\/assets\/pwa-install\.js'/);
  assert.match(sw, /hub-v295-20261122-onibus-eta-safe/);
  assert.match(read('public/assets/app.js'), /hub-v295-20261122-onibus-eta-safe/);
});
