import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html = read('public/index.html');
const css = read('public/assets/styles.css');
const js = read('public/assets/app.js');
const sw = read('public/service-worker.js');

test('tema automático publicado não injeta ícone de monitor',()=>{
 assert.doesNotMatch(html,/theme-icon-system/);
 assert.doesNotMatch(css,/theme-icon-system/);
 assert.match(html,/matchMedia\('\(prefers-color-scheme: dark\)'\)/);
});
test('alternância automática do tema mantém cores e atualização reativa',()=>{
 assert.match(css,/\.theme-toggle \.theme-icon-sun\{display:block\}/);
 assert.match(css,/\.theme-toggle \.theme-icon-moon\{display:none\}/);
 assert.match(css,/:root\[data-theme="dark"\] \.theme-toggle \.theme-icon-sun\{display:none\}/);
 assert.match(css,/:root\[data-theme="dark"\] \.theme-toggle \.theme-icon-moon\{display:block\}/);
 assert.match(js,/const active = media\.matches \? 'dark' : 'light'/);
 assert.match(js,/document\.documentElement\.dataset\.theme = active/);
 assert.match(js,/media\.addEventListener\('change',onChange\)/);
});
test('thumbnail substitui o SVG em vez de colocar um abaixo do outro',()=>{
 assert.match(js,/restaurantThumbHost\.replaceChildren\(restaurantThumbPhoto\)/);
 assert.match(js,/restaurantThumbHost\.replaceChildren\(restaurantThumbFallback\)/);
 assert.match(css,/\.picker-icon\{display:flex;align-items:center;justify-content:center;position:relative\}/);
 assert.match(css,/\.picker-photo\{display:block;flex:0 0 100%;width:100%;height:100%;object-fit:cover/);
});
test('service worker atualiza o cache dos arquivos visuais',()=>{
 assert.match(sw,/const VERSION = '(?:hub-ufmg|hub)-v\d+-[a-z0-9-]+'/);
 for (const path of [
   '/assets/icons/icon-192.png',
   '/assets/icons/icon-512.png',
   '/assets/icons/apple-touch-icon.png'
 ]) assert.ok(sw.includes(path), `Icone fora do cache: ${path}`);
});
