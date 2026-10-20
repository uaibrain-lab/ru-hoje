import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {categoryKey, parseMenuJson} from '../scripts/fump-api.mjs';
import {unregisteredCategory, publishedCategory} from '../public/assets/dish-category.js';

const date='2026-10-20';
const response={cardapios:[{data:date,refeicoes:[
  {tipoRefeicao:'Almoço',pratos:[
    {tipoPrato:'Tipo de item não cadastrado', descricaoPrato:'Frango Xadrez'},
    {tipoPrato:'Prato protéico 3', descricaoPrato:'Bolinho de Ervilha'},
    {tipoPrato:'Tipo de item não cadastrado', descricaoPrato:'Molho Verde'},
    {tipoPrato:'Entrada 1', descricaoPrato:'Salada de Alface com Rúcula'},
    {tipoPrato:'(um copo)', descricaoPrato:'Refresco'},
  ]},
]}]};

test('API: Frango Xadrez sem tipo é classificado como proteína a partir de evidência verificada',()=>{
  assert.equal(categoryKey('Tipo de item não cadastrado','Frango Xadrez'),'proteina');
  assert.equal(unregisteredCategory('FRANGO  XADREZ'),'proteina');
  const {meals,meta}=parseMenuJson(response,{iso:date,sourceId:'2'});
  assert.equal(meals.almoco.items.find(x=>x.name==='Frango Xadrez').category,'proteina');
  assert.equal(meta.ignored,0);
});

test('API: Prato protéico 3 é vegetariano, e Molho Verde é molho',()=>{
  assert.equal(categoryKey('Prato protéico 3'),'vegetariana');
  const {meals}=parseMenuJson(response,{iso:date,sourceId:'2'});
  assert.equal(meals.almoco.items.find(x=>x.name==='Bolinho de Ervilha').category,'vegetariana');
  assert.equal(meals.almoco.items.find(x=>x.name==='Molho Verde').category,'molho');
  assert.equal(categoryKey('Tipo de item não cadastrado','Molho de Tomate com Orégano'),'molho');
  assert.equal(meals.almoco.items.find(x=>x.name==='Refresco').category,'bebida');
});

test('Firestore legado: categoria vazia de Frango Xadrez é corrigida na exibição',()=>{
  assert.equal(publishedCategory('','Frango Xadrez'),'proteina');
  assert.equal(publishedCategory('','Molho Verde'),'molho');
  assert.equal(publishedCategory('','Molho de Tomate com Orégano'),'molho');
});

test('Firestore legado: vegetariano salvo como proteína é corrigido na exibição',()=>{
  for(const name of ['Bolinho de Ervilha','Bife de milho','Cassoulet Vegetariano','Soja Refogada com Legumes']) {
    assert.equal(publishedCategory('proteina',name),'vegetariana',name);
  }
});

test('Sem adivinhação: itens desconhecidos permanecem sem categoria',()=>{
  assert.equal(categoryKey('Tipo de item não cadastrado','Preparação surpresa'), '');
  assert.equal(publishedCategory('','Preparação surpresa'), '');
  assert.equal(publishedCategory('proteina','Carne de porco frita'),'proteina');
  assert.equal(categoryKey('Entrada 2','Frango Xadrez'),'salada'); // tipo oficial reconhecido prevalece
  assert.equal(categoryKey('Bebida','Frango Xadrez'),'bebida');
});

test('Integração: versão do cache e novo módulo offline estão presentes',()=>{
  const sw=fs.readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
  assert.match(sw,/const VERSION = 'bandeco-v\d+-/);
  assert.match(sw,/\/?assets\/dish-category\.js/);
  assert.match(app,/publishedCategory\(item.category, name, item.sourceType\)/);
  assert.match(app,/'Molhos'/);
});
