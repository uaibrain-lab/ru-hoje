
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const get=p=>fs.readFileSync(new URL(p,root),'utf8');
const index=get('public/index.html');
const app=get('public/assets/app.js');
const css=get('public/assets/styles.css');

test('logo do CATM virou ícone do topo e do PWA',()=>{
  assert.match(index,/href="\/assets\/icons\/icon-192\.png"/);
  assert.match(index,/src="\/assets\/icons\/icon-192\.png"/);
  for (const p of ['public/assets/icons/icon-192.png','public/assets/icons/icon-512.png','public/assets/icons/apple-touch-icon.png']) {
    assert.ok(fs.statSync(new URL(p,root)).size > 1000);
  }
});

test('modo automático publicado atualiza preferência dark/light sem monitor',()=>{
  assert.doesNotMatch(index,/theme-icon-system/);
  assert.match(app,/const active = media\.matches \? 'dark' : 'light'/);
  assert.match(app,/document\.documentElement\.dataset\.theme = active/);
});

test('seta de horários usa chevron desenhado em CSS',()=>{
  assert.match(css,/hours-details>summary::after/);
  assert.match(css,/border-right:2px solid currentColor/);
  assert.match(css,/rotate\(45deg\)/);
  assert.match(css,/rotate\(-135deg\)/);
});
