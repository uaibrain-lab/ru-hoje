import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { publishedCategory } from '../public/assets/dish-category.js';
import { categoryKey } from '../scripts/fump-api.mjs';

const legacyVegetarians = ['Bolinho de soja com batata', 'Quibe de Cenoura'];

test('v1.9.5: dois pratos vegetarianos antigos exibem categoria correta sem alterar Firestore',()=>{
  for (const name of legacyVegetarians) {
    assert.equal(publishedCategory('proteina', name),'vegetariana',name);
    assert.equal(publishedCategory('vegetariana', name),'vegetariana',name);
    assert.equal(publishedCategory('PROTEINA', `  ${name.toUpperCase()}  `),'vegetariana',name);
  }
});

test('v1.9.5: itens semelhantes não são reclassificados por suposição',()=>{
  assert.equal(publishedCategory('proteina','Quibe de carne com cenoura'),'proteina');
  assert.equal(publishedCategory('proteina','Frango com soja e batata'),'proteina');
  assert.equal(publishedCategory('proteina','Carne cozida'),'proteina');
  assert.equal(publishedCategory('guarnicao','Quibe de Cenoura'),'guarnicao');
});

test('v1.9.5: novas coletas seguem o tipoPrato oficial, independente do nome',()=>{
  for (const name of legacyVegetarians) {
    assert.equal(categoryKey('Prato protéico 3',name),'vegetariana');
    assert.equal(categoryKey('Prato proteico 3',name),'vegetariana');
    // O nome não substitui um tipoPrato oficial explícito e diferente.
    assert.equal(categoryKey('Prato protéico 1',name),'proteina');
  }
});

test('v1.9.5: módulo offline e mudança de cache',()=>{
  const sw=fs.readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
  assert.match(sw,/const VERSION = 'bandeco-v196-fump-source-types'/);
  assert.match(sw,/\/assets\/dish-category\.js/);
  assert.match(app,/publishedCategory\(item.category, name, item.sourceType\)/);
});
