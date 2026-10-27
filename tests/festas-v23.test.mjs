import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EVENT_TAGS} from '../public/assets/festas-core.js';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('as únicas tags fixas são Open Bar, Open Food e Festa à fantasia',()=>{
  assert.deepEqual([...EVENT_TAGS],['Open Bar','Open Food','Festa à fantasia']);
  const code=read('public/assets/festas.js');
  assert.match(code,/🍹/);assert.match(code,/🍔/);assert.match(code,/🎭/);
  assert.match(code,/admin-show-tag/);assert.match(code,/admin-tag-composer/);
});
test('editor usa upload e remove entrada de URL de imagem e comentário redundante de vagas',()=>{
  const html=read('public/index.html');
  assert.match(html,/id="admin-poster-file"/);
  assert.doesNotMatch(html,/admin-posterUrl|Ou URL HTTPS da imagem|não limita inscrições/);
  const script=read('public/assets/festas.js');
  assert.doesNotMatch(script,/\$\('admin-posterUrl'\)/);
  assert.match(script,/INGRESSOS 🔥/);
});
test('Festas mostra descrição dentro do bloco de detalhes antes da imagem e sem propaganda repetida',()=>{
  const code=read('public/assets/festas.js');
  const segment=code.slice(code.indexOf('function renderEvents'),code.indexOf('function setSignupStep'));
  assert.ok(segment.indexOf('festa-card-desc')>segment.indexOf('festa-details'));
  assert.ok(segment.indexOf('festa-card-desc')<segment.indexOf('festa-art'));
  assert.doesNotMatch(segment,/Publicidade · Parceria CATM/);
});
test('navegação possui quatro abas e Sobre contém integralmente o texto do CATM',()=>{
  const html=read('public/index.html'),code=read('public/assets/festas.js'),css=read('public/assets/styles.css');
  for(const x of ['tab-menu','tab-festas','tab-interno','tab-sobre','sobre-page','interno-page','interno-frame'])assert.match(html,new RegExp(`id="${x}"`));
  assert.match(code,/for\(const tab of \['menu','festas','interno','sobre'\]\)/);
  assert.match(css,/position:fixed/);assert.match(css,/env\(safe-area-inset-bottom/);
  for(const phrase of ['O CATM (Centro Acadêmico da Tropa do Mantém) surgiu','É importante entender o lazer como um direito social','Porém, nosso objetivo não se limita','É fato inegável que a proibição não impede','A regularização não é só pra contornar'])assert.ok(html.includes(phrase),phrase);
});
